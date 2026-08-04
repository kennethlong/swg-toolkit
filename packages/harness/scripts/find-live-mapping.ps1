# find-live-mapping.ps1 - enumerate the current session's BaseNamedObjects namespace and find
# the toolkit's live-inject shared-memory mapping.
#
# WHY THIS EXISTS: the live mapping name is Local\SwgToolkitLive_<random8>, regenerated on every
# attach (useLiveService.ts) and never surfaced anywhere in the UI. drive-host-command.ps1 needs
# that exact name as its -Name argument. Rather than adding UI plumbing just to expose a debug
# driver's argument, this script finds it the same way Process Explorer / WinObj would: by
# opening the session's \BaseNamedObjects directory object and listing it, since Local\ is
# shorthand for that per-session namespace (NOT the same thing as Global\, which always means the
# session-0 \BaseNamedObjects regardless of the caller's own session). It filters the listing for
# SwgToolkitLive_* entries whose object type is Section (a file mapping is a Section kernel
# object).
#
# Usage (from repo root):
#   .\packages\harness\scripts\find-live-mapping.ps1
#   .\packages\harness\scripts\find-live-mapping.ps1 -SessionId 2
#
# Pairs with drive-host-command.ps1 - pipe or copy the printed Local\SwgToolkitLive_xxxxxxxx
# name into that script's -Name argument.

[CmdletBinding()]
param(
    [int]$SessionId = -1
)

$ErrorActionPreference = 'Stop'

$src = @'
using System;
using System.Runtime.InteropServices;
using System.Collections.Generic;

public static class ObjDir {
    [StructLayout(LayoutKind.Sequential)]
    struct UNICODE_STRING {
        public ushort Length;
        public ushort MaximumLength;
        public IntPtr Buffer;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct OBJECT_ATTRIBUTES {
        public int Length;
        public IntPtr RootDirectory;
        public IntPtr ObjectName;
        public uint Attributes;
        public IntPtr SecurityDescriptor;
        public IntPtr SecurityQualityOfService;
    }

    // OBJECT_DIRECTORY_INFORMATION: a Name/TypeName UNICODE_STRING pair per entry; the listing
    // is terminated by an all-zero entry (Name.Buffer == NULL).
    [StructLayout(LayoutKind.Sequential)]
    struct OBJECT_DIRECTORY_INFORMATION {
        public UNICODE_STRING Name;
        public UNICODE_STRING TypeName;
    }

    [DllImport("ntdll.dll")]
    static extern int NtOpenDirectoryObject(out IntPtr handle, uint desiredAccess, ref OBJECT_ATTRIBUTES objAttr);

    [DllImport("ntdll.dll")]
    static extern int NtQueryDirectoryObject(IntPtr handle, IntPtr buffer, int length, bool singleEntry,
        bool restartScan, ref uint context, out uint returnLength);

    [DllImport("ntdll.dll")]
    static extern int NtClose(IntPtr handle);

    const uint DIRECTORY_QUERY = 0x0001;
    const uint OBJ_CASE_INSENSITIVE = 0x40;
    const int BUFFER_SIZE = 65536;
    const int STATUS_NO_MORE_ENTRIES = unchecked((int)0x8000001A);

    public static List<string> ListSectionsByPrefix(string directoryPath, string namePrefix) {
        var results = new List<string>();

        IntPtr nameBuf = Marshal.StringToHGlobalUni(directoryPath);
        var nameUs = new UNICODE_STRING {
            Length = (ushort)(directoryPath.Length * 2),
            MaximumLength = (ushort)(directoryPath.Length * 2 + 2),
            Buffer = nameBuf
        };
        IntPtr nameUsPtr = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(UNICODE_STRING)));
        Marshal.StructureToPtr(nameUs, nameUsPtr, false);

        var objAttr = new OBJECT_ATTRIBUTES {
            Length = Marshal.SizeOf(typeof(OBJECT_ATTRIBUTES)),
            RootDirectory = IntPtr.Zero,
            ObjectName = nameUsPtr,
            Attributes = OBJ_CASE_INSENSITIVE,
            SecurityDescriptor = IntPtr.Zero,
            SecurityQualityOfService = IntPtr.Zero
        };

        IntPtr dirHandle;
        int status = NtOpenDirectoryObject(out dirHandle, DIRECTORY_QUERY, ref objAttr);
        Marshal.FreeHGlobal(nameUsPtr);
        Marshal.FreeHGlobal(nameBuf);
        if (status != 0) {
            throw new Exception(string.Format("NtOpenDirectoryObject({0}) failed, NTSTATUS=0x{1:X8}", directoryPath, status));
        }

        IntPtr buffer = Marshal.AllocHGlobal(BUFFER_SIZE);
        try {
            uint ctx = 0;
            bool restart = true;
            int entrySize = Marshal.SizeOf(typeof(OBJECT_DIRECTORY_INFORMATION));

            while (true) {
                uint returnLength;
                status = NtQueryDirectoryObject(dirHandle, buffer, BUFFER_SIZE, false, restart, ref ctx, out returnLength);
                restart = false;
                if (status == STATUS_NO_MORE_ENTRIES) break;
                if (status != 0) {
                    throw new Exception(string.Format("NtQueryDirectoryObject failed, NTSTATUS=0x{0:X8}", status));
                }

                IntPtr cur = buffer;
                while (true) {
                    var info = (OBJECT_DIRECTORY_INFORMATION)Marshal.PtrToStructure(cur, typeof(OBJECT_DIRECTORY_INFORMATION));
                    if (info.Name.Buffer == IntPtr.Zero) break; // terminator entry for this batch

                    string name = Marshal.PtrToStringUni(info.Name.Buffer, info.Name.Length / 2);
                    string typeName = info.TypeName.Buffer == IntPtr.Zero
                        ? string.Empty
                        : Marshal.PtrToStringUni(info.TypeName.Buffer, info.TypeName.Length / 2);

                    if (name.StartsWith(namePrefix, StringComparison.OrdinalIgnoreCase) &&
                        typeName.Equals("Section", StringComparison.OrdinalIgnoreCase)) {
                        results.Add(name);
                    }

                    cur = IntPtr.Add(cur, entrySize);
                }
            }
        }
        finally {
            Marshal.FreeHGlobal(buffer);
            NtClose(dirHandle);
        }

        return results;
    }
}
'@

Add-Type -TypeDefinition $src -Language CSharp

if ($SessionId -lt 0) {
    $SessionId = (Get-Process -Id $PID).SessionId
}

# Session 0 (services) has its BaseNamedObjects directly at \BaseNamedObjects; every other
# interactive session (1, 2, ...) gets its own namespace at \Sessions\<id>\BaseNamedObjects, and
# that per-session directory is exactly what Local\ resolves against for a caller in that session.
if ($SessionId -eq 0) {
    $dirPath = '\BaseNamedObjects'
} else {
    $dirPath = "\Sessions\$SessionId\BaseNamedObjects"
}

Write-Host ("Scanning {0} for SwgToolkitLive_* Section objects (session {1})..." -f $dirPath, $SessionId)

$found = [ObjDir]::ListSectionsByPrefix($dirPath, 'SwgToolkitLive_')

if ($found.Count -eq 0) {
    Write-Host 'No live mapping found. Is the toolkit attached to a running, injected client?'
    exit 1
}

foreach ($name in $found) {
    Write-Host ("Local\" + $name)
}

if ($found.Count -eq 1) {
    Write-Host ''
    Write-Host 'Pass this to drive-host-command.ps1 -Name:'
    Write-Host ("  Local\" + $found[0])
} else {
    Write-Host ''
    Write-Host ("Multiple candidates found ({0}). Pick the one for your current session/attach." -f $found.Count)
}
