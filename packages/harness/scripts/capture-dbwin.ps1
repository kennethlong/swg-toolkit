# capture-dbwin.ps1 -- read OutputDebugStringA traffic (what the agent's dbg() writes) and append
# it to a file so it can be read without DebugView.
#
# Mechanism is the documented DBWIN protocol: a 4 KB section named DBWIN_BUFFER whose first DWORD
# is the emitting pid followed by an ANSI string, plus two events -- the capturer signals
# DBWIN_BUFFER_READY to say "I am ready for a line", the emitter signals DBWIN_DATA_READY when it
# has written one.
#
# ONLY ONE capturer can exist system-wide. If DebugView (or another capturer) is running this will
# fail to create the objects -- close it first.
#
# ASCII only: Windows PowerShell 5.1 reads .ps1 as ANSI and one non-ASCII byte breaks parsing with
# an error pointing at a later line.

param(
    [string] $OutFile = "$PSScriptRoot\dbwin.log",
    [int]    $Seconds = 3600
)

Add-Type -Namespace Dbg -Name Win -MemberDefinition @'
[DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Auto)]
public static extern IntPtr CreateFileMapping(IntPtr hFile, IntPtr lpAttributes, uint flProtect,
    uint dwMaximumSizeHigh, uint dwMaximumSizeLow, string lpName);
[DllImport("kernel32.dll", SetLastError=true)]
public static extern IntPtr MapViewOfFile(IntPtr hFileMappingObject, uint dwDesiredAccess,
    uint dwFileOffsetHigh, uint dwFileOffsetLow, UIntPtr dwNumberOfBytesToMap);
[DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Auto)]
public static extern IntPtr CreateEvent(IntPtr lpEventAttributes, bool bManualReset,
    bool bInitialState, string lpName);
[DllImport("kernel32.dll", SetLastError=true)]
public static extern bool SetEvent(IntPtr hEvent);
[DllImport("kernel32.dll", SetLastError=true)]
public static extern uint WaitForSingleObject(IntPtr hHandle, uint dwMilliseconds);
'@

$FILE_MAP_READ = 0x0004
$PAGE_READWRITE = 0x04

$bufferReady = [Dbg.Win]::CreateEvent([IntPtr]::Zero, $false, $false, "DBWIN_BUFFER_READY")
if ($bufferReady -eq [IntPtr]::Zero) { throw "CreateEvent(DBWIN_BUFFER_READY) failed -- another capturer (DebugView?) is running" }

$dataReady = [Dbg.Win]::CreateEvent([IntPtr]::Zero, $false, $false, "DBWIN_DATA_READY")
if ($dataReady -eq [IntPtr]::Zero) { throw "CreateEvent(DBWIN_DATA_READY) failed" }

$mapping = [Dbg.Win]::CreateFileMapping([IntPtr]::new(-1), [IntPtr]::Zero, $PAGE_READWRITE, 0, 4096, "DBWIN_BUFFER")
if ($mapping -eq [IntPtr]::Zero) { throw "CreateFileMapping(DBWIN_BUFFER) failed" }

$view = [Dbg.Win]::MapViewOfFile($mapping, $FILE_MAP_READ, 0, 0, [UIntPtr]::new(4096))
if ($view -eq [IntPtr]::Zero) { throw "MapViewOfFile failed" }

"capture started $(Get-Date -Format 'HH:mm:ss')" | Out-File -FilePath $OutFile -Encoding utf8
$deadline = (Get-Date).AddSeconds($Seconds)

while ((Get-Date) -lt $deadline) {
    [void][Dbg.Win]::SetEvent($bufferReady)
    $rc = [Dbg.Win]::WaitForSingleObject($dataReady, 500)
    if ($rc -ne 0) { continue }   # timeout -- loop and re-arm

    $pidVal = [System.Runtime.InteropServices.Marshal]::ReadInt32($view, 0)
    $msg = [System.Runtime.InteropServices.Marshal]::PtrToStringAnsi([IntPtr]::Add($view, 4))
    if ($null -ne $msg) {
        $line = "{0} pid={1} {2}" -f (Get-Date -Format 'HH:mm:ss.fff'), $pidVal, $msg.TrimEnd("`r", "`n")
        Add-Content -Path $OutFile -Value $line -Encoding utf8
    }
}
