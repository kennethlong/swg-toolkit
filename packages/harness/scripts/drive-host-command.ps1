# drive-host-command.ps1 - external driver for the LIVE_HOST_CMD region.
#
# Verification instrument for 05.1-12's blocking live checkpoint: START_PLACEMENT has no UI yet
# (Plan 14 wires the modal and is downstream of this gate), so the checkpoint's step 2 has to poke
# the channel from outside the app.
#
# WHY THIS IS NOT THE .cjs SIBLING: the obvious approach - require the addon and call
# openChannel + writeHostCommand - is DESTRUCTIVE against a live session. openChannel
# (channel_binding.cpp) ends with an unconditional
#     std::memset(view, 0, CHANNEL_BYTE_SIZE);
# so attaching from a second process ZEROES the whole 1864-byte channel the app and the injected
# agent are actively using, including the CAPTURE region and any in-flight rebind. It also silently
# breaks the very command you are trying to send: wiping HOST_CMD_EPOCH back to 0 makes the next
# write re-use an epoch the agent already consumed, and the agent correctly de-dupes it away, so you
# get no ack and no clue why.
#
# This script therefore attaches with OpenFileMappingA (open-existing only, never create, never
# memset) and writes the HOST_CMD request region directly, mirroring WriteHostCommand's seqlock
# discipline byte for byte: seq -> odd, payload, seq -> even. RESULT_CODE/RESULT_EPOCH are
# agent-authoritative and never touched here.
#
# Offsets/action codes are transcribed from packages/contracts/src/live-inject.ts
# (LIVE_HOST_CMD_LAYOUT / LIVE_HOST_CMD_ACTION) and the write order from
# packages/live-inject/src/channel_binding.cpp WriteHostCommand. If either changes, this is stale.
#
# Usage (from repo root):
#   .\packages\harness\scripts\drive-host-command.ps1 -Name 'Local\SwgToolkitLive_xxxxxxxx' -Peek
#   .\packages\harness\scripts\drive-host-command.ps1 -Name '...' -Action start `
#        -Template 'object/static/item/shared_item_bottle_tall.iff' -Cell 'cantina'
#   .\packages\harness\scripts\drive-host-command.ps1 -Name '...' -Action cancel
#   .\packages\harness\scripts\drive-host-command.ps1 -Name '...' -Action reload
#   .\packages\harness\scripts\drive-host-command.ps1 -Name '...' -Action teleport -Vec3 512,0,-1340
#   .\packages\harness\scripts\drive-host-command.ps1 -Name '...' -Action refreshinterior -Id 1082874
#
# refreshinterior (contract v32) rebuilds ONE building's interior from its current .ilf with no
# scene reload - the way to see an edit land in an OCCUPIED building, which is kept across a
# reload and otherwise keeps rendering its pre-edit interior until a zone change or relog. The
# agent refuses (code 0) while a snapshot parse is in flight or while a decoration is armed.
#
# The mapping name is regenerated on every attach (Local\SwgToolkitLive_<random8>,
# useLiveService.ts) and is not shown in the UI; find-live-mapping.ps1 enumerates it from the
# Local\ named-object namespace.
#
# This script verifies nothing. It sends one command and reports the agent's ack. Every in-game
# observation the checkpoint asks for is the maintainer's to make.

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Name,
    [ValidateSet('reload', 'editorscene', 'teleport', 'start', 'cancel', 'despawn', 'refreshinterior')][string]$Action,
    [string]$Template = '',
    [string]$Cell = '',
    [string]$Avatar = '',
    [string]$Id = '0',
    [float[]]$Vec3 = @(0, 0, 0),
    [int]$TimeoutMs = 12000,
    [switch]$Peek
)

$ErrorActionPreference = 'Stop'

$src = @'
using System;
using System.Runtime.InteropServices;
using System.Threading;

public static class HostCmd {
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Ansi)]
    static extern IntPtr OpenFileMappingA(uint access, bool inherit, string name);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr MapViewOfFile(IntPtr h, uint access, uint offHi, uint offLo, UIntPtr bytes);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool UnmapViewOfFile(IntPtr addr);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CloseHandle(IntPtr h);

    const uint FILE_MAP_ALL_ACCESS = 0x000F001F;
    const int  SIZE = 1864;

    // LIVE_HOST_CMD_LAYOUT
    const int SEQ = 1440, EPOCH = 1444, ACTION = 1448, STR1 = 1452, STR2 = 1708,
              ID = 1836, VEC3 = 1844, RESULT_CODE = 1856, RESULT_EPOCH = 1860;

    static IntPtr _map = IntPtr.Zero;
    static IntPtr _view = IntPtr.Zero;

    public static void Attach(string name) {
        // OPEN EXISTING ONLY. Never CreateFileMapping (would mint a dead, agent-less mapping)
        // and never memset (would wipe the live session's channel).
        _map = OpenFileMappingA(FILE_MAP_ALL_ACCESS, false, name);
        if (_map == IntPtr.Zero)
            throw new Exception("OpenFileMappingA failed (err " + Marshal.GetLastWin32Error() +
                "). No live session owns that name.");
        _view = MapViewOfFile(_map, FILE_MAP_ALL_ACCESS, 0, 0, (UIntPtr)SIZE);
        if (_view == IntPtr.Zero) {
            CloseHandle(_map);
            throw new Exception("MapViewOfFile failed (err " + Marshal.GetLastWin32Error() + ")");
        }
    }

    public static void Detach() {
        if (_view != IntPtr.Zero) { UnmapViewOfFile(_view); _view = IntPtr.Zero; }
        if (_map != IntPtr.Zero) { CloseHandle(_map); _map = IntPtr.Zero; }
    }

    public static int Read(int off) { return Marshal.ReadInt32(_view, off); }

    static void WriteBytes(int off, byte[] data, int slot) {
        for (int i = 0; i < slot; i++)
            Marshal.WriteByte(_view, off + i, i < data.Length ? data[i] : (byte)0);
    }

    /// Mirrors WriteHostCommand's seqlock write: seq -> odd, payload, seq -> even.
    /// Aligned 32-bit stores are atomic on x86/x64; MemoryBarrier supplies the ordering
    /// that InterlockedIncrement provides on the C++ side.
    public static void Write(int epoch, int action, string str1, string str2, ulong id, float[] vec3) {
        int seq = Marshal.ReadInt32(_view, SEQ);
        Marshal.WriteInt32(_view, SEQ, seq + 1);          // odd: write in progress
        Thread.MemoryBarrier();

        Marshal.WriteInt32(_view, EPOCH, epoch);
        Marshal.WriteInt32(_view, ACTION, action);
        WriteBytes(STR1, System.Text.Encoding.ASCII.GetBytes(str1 ?? ""), 256);
        WriteBytes(STR2, System.Text.Encoding.ASCII.GetBytes(str2 ?? ""), 128);
        Marshal.WriteInt64(_view, ID, (long)id);
        for (int i = 0; i < 3; i++)
            Marshal.WriteInt32(_view, VEC3 + i * 4, BitConverter.ToInt32(BitConverter.GetBytes(vec3[i]), 0));

        Thread.MemoryBarrier();
        Marshal.WriteInt32(_view, SEQ, seq + 2);          // even: write complete
    }

    public static int CmdEpoch()    { return Read(EPOCH); }
    public static int CmdAction()   { return Read(ACTION); }
    public static int ResultEpoch() { return Read(RESULT_EPOCH); }
    public static int ResultCode()  { return Read(RESULT_CODE); }
}
'@

Add-Type -TypeDefinition $src -Language CSharp | Out-Null

$ActionMap = @{ reload = 1; editorscene = 2; teleport = 3; start = 4; cancel = 5; despawn = 6; refreshinterior = 7 }
$ActionNameMap = @{ 1 = 'reload'; 2 = 'editorscene'; 3 = 'teleport'; 4 = 'start'; 5 = 'cancel'; 6 = 'despawn'; 7 = 'refreshinterior' }

# Mirrors describeHostCommandResult() in packages/renderer/src/services/hostCommand.ts
function Get-ResultText([int]$action, [int]$code) {
    if ($action -eq 6) {
        switch ($code) {
            1 { return 'despawned' }
            0 { return 'not found (already gone or buildout-provenance)' }
            -1 { return 'occupied - try again' }
            default { return 'unknown outcome' }
        }
    }
    if ($action -eq 7) {
        switch ($code) {
            1 { return 'interior rebuilt' }
            0 { return 'not refreshed (no such building, not a POB, still loading, or an edit is armed)' }
            -1 { return 'layout reload failed' }
            default { return 'unknown outcome' }
        }
    }
    if ($code -eq 1) { return 'ok' } else { return 'endpoint unresolved or failed' }
}

[HostCmd]::Attach($Name)
try {
    $cmdEpoch = [HostCmd]::CmdEpoch()
    $cmdAction = [HostCmd]::CmdAction()
    $resEpoch = [HostCmd]::ResultEpoch()
    $resCode = [HostCmd]::ResultCode()

    if ($Peek) {
        Write-Host 'HOST_CMD region (live, not modified):'
        $an = if ($ActionNameMap.ContainsKey($cmdAction)) { ' = ' + $ActionNameMap[$cmdAction] } else { '' }
        Write-Host ("  command epoch : {0}  (action {1}{2})" -f $cmdEpoch, $cmdAction, $an)
        Write-Host ("  result  epoch : {0}  code {1}" -f $resEpoch, $resCode)
        return
    }

    if (-not $Action) { throw '-Action is required unless -Peek is used.' }
    $act = $ActionMap[$Action]

    # Past whatever the agent has already consumed, so it sees a genuinely new command rather
    # than a replay it de-dupes away.
    $epoch = ([Math]::Max($cmdEpoch, $resEpoch)) + 1

    $str1 = if ($Action -eq 'editorscene') { $Template } else { $Template }
    $str2 = if ($Action -eq 'editorscene') { $Avatar } else { $Cell }

    Write-Host ("-> {0} (action {1}), epoch {2}" -f $Action, $act, $epoch)
    if ($str1) { Write-Host ("   str1 : " + $str1) }
    if ($str2) { Write-Host ("   str2 : " + $str2) }
    if ($Id -ne '0') { Write-Host ("   id   : " + $Id) }
    if ($act -eq 3) { Write-Host ("   vec3 : " + ($Vec3 -join ', ')) }

    [HostCmd]::Write($epoch, $act, $str1, $str2, [uint64]$Id, $Vec3)

    # Poll for the ack. The agent publishes code FIRST, epoch LAST, so a matching epoch means
    # the code beside it is settled.
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    while ($true) {
        $re = [HostCmd]::ResultEpoch()
        if ($re -eq $epoch) {
            $rc = [HostCmd]::ResultCode()
            Write-Host ("<- ack epoch {0}, code {1} - {2}" -f $re, $rc, (Get-ResultText $act $rc))
            Write-Host ("   ({0} ms)" -f $sw.ElapsedMilliseconds)
            if ($rc -ne 1) { exit 1 }
            return
        }
        if ($sw.ElapsedMilliseconds -gt $TimeoutMs) {
            Write-Host ("x no ack for epoch {0} within {1} ms." -f $epoch, $TimeoutMs)
            Write-Host ("  last result seen: epoch {0}, code {1}" -f $re, [HostCmd]::ResultCode())
            Write-Host '  Is the client injected, in-world, and the agent running its frame loop?'
            exit 1
        }
        Start-Sleep -Milliseconds 100
    }
}
finally {
    [HostCmd]::Detach()
}
