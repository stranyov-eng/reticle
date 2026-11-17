#Requires -Version 5.1
<#
.SYNOPSIS
    Measure SMB read and write speed across a row of servers using nothing but
    what ships with Windows.

.DESCRIPTION
    Reticle measures with its own I/O loop. Before its numbers are used to tell
    somebody their network is misconfigured, they are worth confirming with code
    that nobody in this room wrote: robocopy moves the bytes and Stopwatch times
    them from outside.

    Writes send a locally generated, incompressible file to each share.

    Reads pull an *existing* file back — existing on purpose. A file this
    machine wrote a second ago is still in this machine's own RAM, and reading
    it back would measure that rather than the network. That is the one real
    trap in this kind of test.

    Nothing is left behind: the file written to each share is removed, including
    after a failure.

.PARAMETER ReadFile
    Path of the file to read, relative to the share, the same on every server —
    'objects/big.mov'. Strongly preferred: servers compared against different
    files are not compared at all, and naming it also skips the directory scan.
    Without it the script looks for a suitable file on each server by itself.

.PARAMETER MaxReadMB
    Above this size a file is read in part rather than copied whole, so one
    enormous clip cannot turn a quick check into a quarter of an hour.

.PARAMETER Repeat
    Run the whole row more than once. If the same servers are slow on every pass
    it is configuration; if the slow ones move around it is contention or
    something intermittent — different problems with different culprits.

.EXAMPLE
    .\smb-check.ps1 -First 192.168.2.11 -Last 192.168.2.19 -Share 'd3 Projects\01_ADNOC_National_Day_v01\objects' -Repeat 3
#>

param(
    [Parameter(Mandatory = $true)] [string] $First,
    [Parameter(Mandatory = $true)] [string] $Last,
    [Parameter(Mandatory = $true)] [string] $Share,
    [string] $ReadFile,
    [int] $SizeMB = 512,
    [int] $MaxReadMB = 2048,
    [int] $Repeat = 1
)

$ErrorActionPreference = 'Stop'
$BlockSize = 4194304

function Get-AddressRange {
    param([string] $From, [string] $To)

    $a = $From.Split('.')
    $b = $To.Split('.')
    if ($a.Count -ne 4 -or $b.Count -ne 4) { throw 'Both ends must be IPv4 addresses.' }

    $prefix = "$($a[0]).$($a[1]).$($a[2])"
    if ($prefix -ne "$($b[0]).$($b[1]).$($b[2])") { throw 'Both ends must share the first three octets.' }

    $lo = [int] $a[3]
    $hi = [int] $b[3]
    if ($lo -gt $hi) { throw 'The first address must come before the last.' }

    $lo..$hi | ForEach-Object { "$prefix.$_" }
}

function Add-Note {
    param([string] $Existing, [string] $Add)
    if ([string]::IsNullOrWhiteSpace($Existing)) { return $Add }
    return "$Existing; $Add"
}

# A host that is off answers nothing, and Test-Path against it blocks for the
# better part of a minute. Two seconds on port 445 settles it first.
function Test-SmbPort {
    param([string] $Address, [int] $TimeoutMs = 2000)

    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $pending = $client.BeginConnect($Address, 445, $null, $null)
        if (-not $pending.AsyncWaitHandle.WaitOne($TimeoutMs)) { return $false }
        $client.EndConnect($pending)
        return $true
    }
    catch { return $false }
    finally { $client.Close() }
}

# Robocopy, timed by us rather than parsed out of its own output: its wording is
# localised and its summary is not worth depending on.
function Invoke-TimedCopy {
    param([string] $SourceDir, [string] $FileName, [string] $DestDir)

    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    & robocopy $SourceDir $DestDir $FileName /R:0 /W:0 /NJH /NJS /NC /NS /NP /NFL /NDL | Out-Null
    $code = $LASTEXITCODE
    $sw.Stop()

    # Robocopy reports 0-7 for success, 8 and above for failure.
    if ($code -ge 8) { return $null }
    return $sw.Elapsed.TotalSeconds
}

# Prefer a file big enough to measure but small enough to be quick. The scan is
# capped in depth and in entries: a project folder can hold tens of thousands of
# files, and over a share that crawls, enumerating them all is the slow part.
function Find-ReadSource {
    param([string] $Root, [long] $MinBytes, [long] $MaxBytes)

    $banded = Get-ChildItem -LiteralPath $Root -File -Recurse -Depth 3 -ErrorAction SilentlyContinue |
        Where-Object { $_.Length -ge $MinBytes -and $_.Length -le $MaxBytes } |
        Select-Object -First 1
    if ($banded) { return $banded }

    Get-ChildItem -LiteralPath $Root -File -Recurse -Depth 3 -ErrorAction SilentlyContinue |
        Where-Object { $_.Length -ge $MinBytes } |
        Select-Object -First 1
}

# Whole file through robocopy where that is quick; otherwise the first slice of
# it through plain buffered reads, so the run takes a time you can predict.
function Measure-Read {
    param([System.IO.FileInfo] $Source, [string] $Landing, [long] $CapBytes)

    if ($Source.Length -le $CapBytes) {
        $seconds = Invoke-TimedCopy -SourceDir $Source.DirectoryName -FileName $Source.Name -DestDir $Landing
        Remove-Item -LiteralPath (Join-Path $Landing $Source.Name) -Force -ErrorAction SilentlyContinue
        if ($null -eq $seconds -or $seconds -le 0) { return $null }
        return [pscustomobject] @{
            MBs     = [math]::Round(($Source.Length / 1MB) / $seconds)
            Partial = $false
            Via     = 'robocopy'
        }
    }

    $buffer = New-Object byte[] $BlockSize
    $stream = [System.IO.File]::OpenRead($Source.FullName)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $done = [long] 0
    try {
        while ($done -lt $CapBytes) {
            $n = $stream.Read($buffer, 0, $buffer.Length)
            if ($n -le 0) { break }
            $done += $n
        }
    }
    finally {
        $sw.Stop()
        $stream.Dispose()
    }

    if ($sw.Elapsed.TotalSeconds -le 0 -or $done -le 0) { return $null }
    return [pscustomobject] @{
        MBs     = [math]::Round(($done / 1MB) / $sw.Elapsed.TotalSeconds)
        Partial = $true
        # Named in the output: robocopy cannot copy part of a file, so an
        # oversized one is read here instead, and a report that said "measured
        # by robocopy" for both halves would be claiming more than it did.
        Via     = 'slice'
    }
}

$scratch = Join-Path $env:TEMP 'reticle-smb-check'
$landing = Join-Path $scratch 'in'
New-Item -ItemType Directory -Force -Path $scratch, $landing | Out-Null

$payloadName = 'smb-check-payload.bin'
$payload = Join-Path $scratch $payloadName
$minBytes = [long] $SizeMB * 1MB
$capBytes = [long] $MaxReadMB * 1MB
$results = @()

try {
    Write-Host "Building a $SizeMB MB incompressible payload..." -ForegroundColor DarkGray
    $payloadBlock = New-Object byte[] $BlockSize
    $rng = New-Object System.Security.Cryptography.RNGCryptoServiceProvider
    $rng.GetBytes($payloadBlock)

    $stream = [System.IO.File]::Create($payload)
    try {
        $blocks = [math]::Max(1, [int] ($SizeMB / 4))
        for ($i = 0; $i -lt $blocks; $i++) { $stream.Write($payloadBlock, 0, $payloadBlock.Length) }
    }
    finally {
        $stream.Dispose()
    }

    $addresses = @(Get-AddressRange -From $First -To $Last)
    $sent = (Get-Item $payload).Length

    foreach ($pass in 1..$Repeat) {
        if ($Repeat -gt 1) { Write-Host "`nPass $pass of $Repeat" -ForegroundColor Cyan }

        foreach ($address in $addresses) {
            $root = "\\$address\$Share"
            $row = [pscustomobject] @{
                # The clock goes in the row: when a fault wanders between runs,
                # the time a reading was taken is half of what identifies it.
                Pass = $pass; When = (Get-Date -Format 'HH:mm:ss'); Server = $address
                ReadMBs = $null; WriteMBs = $null; ReadVia = ''; File = ''; Note = ''
            }

            Write-Host ("{0,-16} " -f $address) -NoNewline

            if (-not (Test-SmbPort -Address $address)) {
                $row.Note = 'no answer on port 445'
                $results += $row
                Write-Host 'unreachable' -ForegroundColor DarkYellow
                continue
            }

            if (-not (Test-Path -LiteralPath $root)) {
                $row.Note = 'share not found'
                $results += $row
                Write-Host 'share not found' -ForegroundColor DarkYellow
                continue
            }

            # --- write ---
            Write-Host 'writing... ' -NoNewline -ForegroundColor DarkGray
            try {
                $seconds = Invoke-TimedCopy -SourceDir $scratch -FileName $payloadName -DestDir $root
                if ($seconds -gt 0) {
                    $row.WriteMBs = [math]::Round(($sent / 1MB) / $seconds)
                }
                else {
                    $row.Note = Add-Note $row.Note 'write failed'
                }
            }
            catch {
                $row.Note = Add-Note $row.Note "write: $($_.Exception.Message)"
            }
            finally {
                # Leftovers in a show folder are worse than a missing reading.
                Remove-Item -LiteralPath (Join-Path $root $payloadName) -Force -ErrorAction SilentlyContinue
            }

            # --- read ---
            $source = $null
            if ($ReadFile) {
                $named = Join-Path $root $ReadFile
                if (Test-Path -LiteralPath $named -PathType Leaf) {
                    $source = Get-Item -LiteralPath $named
                }
                else {
                    $row.Note = Add-Note $row.Note "no $ReadFile here"
                }
            }
            else {
                Write-Host 'scanning... ' -NoNewline -ForegroundColor DarkGray
                $source = Find-ReadSource -Root $root -MinBytes $minBytes -MaxBytes $capBytes
                if ($null -eq $source) {
                    $row.Note = Add-Note $row.Note "nothing of $SizeMB MB or more here to read"
                }
            }

            if ($source) {
                $row.File = $source.Name
                $sizeMBofFile = [math]::Round($source.Length / 1MB)
                Write-Host ("reading {0} ({1} MB)... " -f $source.Name, $sizeMBofFile) -NoNewline -ForegroundColor DarkGray
                try {
                    $read = Measure-Read -Source $source -Landing $landing -CapBytes $capBytes
                    if ($null -eq $read) {
                        $row.Note = Add-Note $row.Note 'read failed'
                    }
                    else {
                        $row.ReadMBs = $read.MBs
                        if ($read.Partial) {
                            $row.Note = Add-Note $row.Note "read first $MaxReadMB MB of $sizeMBofFile MB"
                        }
                    }
                }
                catch {
                    $row.Note = Add-Note $row.Note "read: $($_.Exception.Message)"
                }
            }

            $results += $row
            Write-Host ("read {0,6} MB/s   write {1,6} MB/s   {2}" -f $row.ReadMBs, $row.WriteMBs, $row.Note)
        }
    }
}
finally {
    Remove-Item -LiteralPath $scratch -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "`n--- results ---" -ForegroundColor Cyan
$results | Format-Table -AutoSize

$reads = @($results | Where-Object { $_.ReadMBs } | Select-Object -ExpandProperty ReadMBs)
if ($reads.Count -gt 1) {
    $best = ($reads | Measure-Object -Maximum).Maximum
    $slow = @($results | Where-Object { $_.ReadMBs -and $_.ReadMBs -lt ($best / 2) })

    if ($slow.Count -gt 0) {
        $names = ($slow | Select-Object -ExpandProperty Server -Unique) -join ', '
        Write-Host "Slow on reads: $names (against $best MB/s elsewhere)." -ForegroundColor Yellow
        Write-Host 'Measured by robocopy and the system clock, so this is not Reticle talking.' -ForegroundColor DarkGray
    }
    else {
        Write-Host 'Reads are even across the row.' -ForegroundColor Green
    }

    if (-not $ReadFile) {
        $files = @($results | Where-Object { $_.File } | Select-Object -ExpandProperty File -Unique)
        if ($files.Count -gt 1) {
            Write-Host "`nEach server was read against a different file, so these are not strictly comparable." -ForegroundColor DarkYellow
            Write-Host 'Pass -ReadFile with a path that exists on all of them to compare like with like.' -ForegroundColor DarkGray
        }
    }
}

# Robocopy's own exit code would otherwise become the script's, and its "1"
# means "files were copied" — success that looks like failure to everything
# downstream.
exit 0
