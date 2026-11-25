$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$request = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encodedRequest)) | ConvertFrom-Json
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, WindowsBase, Accessibility, System.Drawing
Add-Type -ReferencedAssemblies UIAutomationClient, UIAutomationTypes, WindowsBase, Accessibility, System.Drawing -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows;
using System.Windows.Automation;
using Accessibility;
using Microsoft.Win32;

public static class OpenBarTray
{
    [StructLayout(LayoutKind.Sequential)]
    private struct POINT { public int X, Y; }
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr FindWindow(string name, string title);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string name, string title);
    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll")]
    private static extern bool GetCursorPos(out POINT point);
    [DllImport("user32.dll")]
    private static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")]
    private static extern IntPtr WindowFromPoint(POINT point);
    [DllImport("user32.dll")]
    private static extern IntPtr GetAncestor(IntPtr window, uint flags);
    [DllImport("user32.dll")]
    private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")]
    private static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int w, int h, uint flags);
    [DllImport("user32.dll")]
    private static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")]
    private static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extra);
    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
    [DllImport("user32.dll")]
    private static extern IntPtr SendMessageTimeout(IntPtr window, uint msg, IntPtr wParam, IntPtr lParam,
        uint flags, uint timeout, out IntPtr result);
    [DllImport("user32.dll")]
    private static extern IntPtr CopyIcon(IntPtr icon);
    [DllImport("user32.dll")]
    private static extern bool DestroyIcon(IntPtr icon);
    [DllImport("kernel32.dll")]
    private static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")]
    private static extern IntPtr VirtualAllocEx(IntPtr process, IntPtr address, UIntPtr size, uint allocation, uint protect);
    [DllImport("kernel32.dll")]
    private static extern bool VirtualFreeEx(IntPtr process, IntPtr address, UIntPtr size, uint type);
    [DllImport("kernel32.dll")]
    private static extern bool ReadProcessMemory(IntPtr process, IntPtr address, byte[] bytes, UIntPtr length, out UIntPtr read);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder path, ref int length);
    [DllImport("shell32.dll")]
    private static extern int SHGetKnownFolderPath(ref Guid folder, uint flags, IntPtr token, out IntPtr path);
    [DllImport("oleacc.dll")]
    private static extern int AccessibleObjectFromWindow(IntPtr window, uint objectId, ref Guid iid,
        [MarshalAs(UnmanagedType.Interface)] out IAccessible accessible);
    [DllImport("oleacc.dll")]
    private static extern int AccessibleChildren(IAccessible accessible, int first, int count,
        [Out, MarshalAs(UnmanagedType.LPArray, ArraySubType = UnmanagedType.Struct, SizeParamIndex = 2)] object[] children,
        out int obtained);

    public sealed class Entry
    {
        public string Id { get; set; }
        public string Name { get; set; }
        public uint OwnerPid { get; set; }
        public string Exe { get; set; }
        public string AppName { get; set; }
        public string IconPng { get; set; }
        internal Rect Bounds;
        internal IntPtr Surface;
    }

    public sealed class Result
    {
        public List<Entry> Items { get; set; }
        public bool Clicked { get; set; }
    }

    private static IntPtr Child(IntPtr parent, string name)
    {
        return parent == IntPtr.Zero ? IntPtr.Zero : FindWindowEx(parent, IntPtr.Zero, name, null);
    }

    private static string ExePath(uint pid)
    {
        if (pid == 0) return null;
        IntPtr process = OpenProcess(0x1000, false, pid);
        if (process == IntPtr.Zero) return null;
        try
        {
            var path = new StringBuilder(2048);
            int length = path.Capacity;
            return QueryFullProcessImageName(process, 0, path, ref length) ? path.ToString() : null;
        }
        finally { CloseHandle(process); }
    }

    private static void SetExe(Entry entry, string exe)
    {
        if (String.IsNullOrEmpty(exe)) return;
        entry.Exe = exe;
        if (String.Equals(exe, Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "explorer.exe"),
            StringComparison.OrdinalIgnoreCase)) return;
        try { entry.AppName = FileVersionInfo.GetVersionInfo(exe).FileDescription; }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }

    private static string IconPng(IntPtr handle)
    {
        IntPtr icon = CopyIcon(handle);
        if (icon == IntPtr.Zero) return null;
        try
        {
            using (var source = Icon.FromHandle(icon))
            using (var bitmap = source.ToBitmap())
            using (var stream = new MemoryStream())
            {
                bitmap.Save(stream, System.Drawing.Imaging.ImageFormat.Png);
                return Convert.ToBase64String(stream.ToArray());
            }
        }
        catch (ArgumentException) { return null; }
        catch (ExternalException) { return null; }
        finally { DestroyIcon(icon); }
    }

    private static IntPtr ReadPointer(byte[] bytes, int offset)
    {
        return IntPtr.Size == 8 ? new IntPtr(BitConverter.ToInt64(bytes, offset)) : new IntPtr(BitConverter.ToInt32(bytes, offset));
    }

    private static bool ReadBytes(IntPtr process, IntPtr address, byte[] buffer)
    {
        UIntPtr read;
        var length = new UIntPtr((uint)buffer.Length);
        return address != IntPtr.Zero && ReadProcessMemory(process, address, buffer, length, out read) && read == length;
    }

    private static void ReadToolbarMetadata(List<Entry> entries, IntPtr toolbar, int first)
    {
        uint shellPid;
        GetWindowThreadProcessId(toolbar, out shellPid);
        // TB_GETBUTTON writes into Explorer; dwData points to its classic notification record.
        IntPtr shell = OpenProcess(0x0018, false, shellPid);
        if (shell == IntPtr.Zero) return;
        IntPtr remote = IntPtr.Zero;
        try
        {
            int dataOffset = IntPtr.Size == 8 ? 16 : 12;
            var button = new byte[dataOffset + IntPtr.Size * 2];
            var data = new byte[16 + IntPtr.Size * 2];
            remote = VirtualAllocEx(shell, IntPtr.Zero, new UIntPtr((uint)button.Length), 0x3000, 4);
            if (remote == IntPtr.Zero) return;
            for (int i = first; i < entries.Count; i++)
            {
                Entry entry = entries[i];
                int index = Int32.Parse(entry.Id.Substring(entry.Id.IndexOf(':') + 1));
                IntPtr result;
                if (SendMessageTimeout(toolbar, 0x0417, new IntPtr(index), remote, 2, 150, out result) == IntPtr.Zero) break;
                if (result == IntPtr.Zero || !ReadBytes(shell, remote, button) ||
                    !ReadBytes(shell, ReadPointer(button, dataOffset), data)) continue;
                uint pid;
                GetWindowThreadProcessId(ReadPointer(data, 0), out pid);
                entry.OwnerPid = pid;
                SetExe(entry, ExePath(pid));
                entry.IconPng = IconPng(ReadPointer(data, 16 + IntPtr.Size));
            }
        }
        finally
        {
            if (remote != IntPtr.Zero) VirtualFreeEx(shell, remote, UIntPtr.Zero, 0x8000);
            CloseHandle(shell);
        }
    }

    private static void ReadToolbar(List<Entry> entries, IntPtr surface, IntPtr parent, string section, bool metadata)
    {
        IntPtr toolbar = Child(parent, "ToolbarWindow32");
        if (toolbar == IntPtr.Zero) return;
        Guid iid = typeof(IAccessible).GUID;
        IAccessible accessible;
        if (AccessibleObjectFromWindow(toolbar, 0xfffffffc, ref iid, out accessible) != 0 || accessible == null) return;
        object[] children = new object[Math.Min(128, accessible.accChildCount)];
        int obtained;
        if (AccessibleChildren(accessible, 0, children.Length, children, out obtained) < 0) return;
        int first = entries.Count;
        for (int i = 0; i < obtained; i++)
        {
            object child = children[i];
            IAccessible item = child as IAccessible ?? accessible;
            object id = child is IAccessible ? 0 : child;
            try
            {
                int role = Convert.ToInt32(item.get_accRole(id));
                if (role != 43 && role != 57) continue; // push button or button menu
                string name = item.get_accName(id);
                if (String.IsNullOrWhiteSpace(name)) continue;
                int x, y, w, h;
                item.accLocation(out x, out y, out w, out h, id);
                entries.Add(new Entry { Id = section + ":" + i, Name = name.Trim(),
                    Bounds = new Rect(x, y, Math.Max(0, w), Math.Max(0, h)), Surface = surface });
            }
            catch (COMException) { }
        }
        if (metadata) ReadToolbarMetadata(entries, toolbar, first);
    }

    private static string ResolveExe(string value)
    {
        if (String.IsNullOrWhiteSpace(value)) return null;
        string exe = Environment.ExpandEnvironmentVariables(value.Trim());
        int close = exe.IndexOf('}');
        Guid folder;
        if (exe.StartsWith("{", StringComparison.Ordinal) && close > 0 &&
            Guid.TryParse(exe.Substring(0, close + 1), out folder))
        {
            IntPtr path;
            if (SHGetKnownFolderPath(ref folder, 0, IntPtr.Zero, out path) != 0) return null;
            try { exe = Marshal.PtrToStringUni(path) + exe.Substring(close + 1); }
            finally { Marshal.FreeCoTaskMem(path); }
        }
        return File.Exists(exe) ? exe : null;
    }

    private static void ReadModernMetadata(List<Entry> entries)
    {
        // UIA identifies the live icon, while Explorer's per-user registry supplies its executable.
        using (var settings = Registry.CurrentUser.OpenSubKey(@"Control Panel\NotifyIconSettings"))
        {
            if (settings == null) return;
            var candidates = new List<KeyValuePair<string, string>>();
            foreach (string key in settings.GetSubKeyNames())
            {
                using (var icon = settings.OpenSubKey(key))
                {
                    if (icon == null) continue;
                    string label = icon.GetValue("InitialTooltip") as string;
                    string exe = ResolveExe(icon.GetValue("ExecutablePath") as string);
                    if (!String.IsNullOrWhiteSpace(label) && exe != null)
                        candidates.Add(new KeyValuePair<string, string>(label.Trim(), exe));
                }
            }
            foreach (Entry entry in entries)
            {
                var matches = candidates.Where(icon => String.Equals(icon.Key, entry.Name, StringComparison.OrdinalIgnoreCase) ||
                    entry.Name.StartsWith(icon.Key + " is ", StringComparison.OrdinalIgnoreCase) ||
                    entry.Name.StartsWith(icon.Key + " - ", StringComparison.OrdinalIgnoreCase) ||
                    entry.Name.StartsWith(icon.Key + "\n", StringComparison.OrdinalIgnoreCase))
                    .Select(icon => icon.Value).Distinct(StringComparer.OrdinalIgnoreCase).Take(2).ToArray();
                if (matches.Length == 1) SetExe(entry, matches[0]);
            }
        }
    }

    private static readonly Condition Icons = new OrCondition(
        new PropertyCondition(AutomationElement.ClassNameProperty, "SystemTray.NotifyIconView"),
        new PropertyCondition(AutomationElement.AutomationIdProperty, "NotifyItemIcon"));

    private static void ReadModern(List<Entry> entries, IntPtr surface, string section)
    {
        if (surface == IntPtr.Zero) return;
        IntPtr bridge = Child(surface, "Windows.UI.Composition.DesktopWindowContentBridge");
        AutomationElement root = AutomationElement.FromHandle(bridge == IntPtr.Zero ? surface : bridge);
        AutomationElementCollection icons = root.FindAll(TreeScope.Descendants, Icons);
        for (int i = 0; i < Math.Min(icons.Count, 128); i++)
        {
            AutomationElement item = icons[i];
            string name = item.Current.Name;
            if (String.IsNullOrWhiteSpace(name)) name = item.Current.HelpText;
            if (String.IsNullOrWhiteSpace(name)) continue;
            entries.Add(new Entry { Id = section + ":" + i, Name = name.Trim(),
                Bounds = item.Current.BoundingRectangle, Surface = surface });
        }
    }

    private static IntPtr Overflow(bool classic)
    {
        return classic ? FindWindow("NotifyIconOverflowWindow", null) :
            FindWindow("TopLevelWindowForOverflowXamlIsland", null);
    }

    private static bool TryClick(IntPtr surface, Rect bounds, bool right)
    {
        if (surface == IntPtr.Zero || bounds.IsEmpty || bounds.Width <= 0 || bounds.Height <= 0) return false;
        POINT point = new POINT { X = (int)(bounds.X + bounds.Width / 2), Y = (int)(bounds.Y + bounds.Height / 2) };
        IntPtr target = WindowFromPoint(point);
        if (target != surface && GetAncestor(target, 2) != surface) return false;
        if (!SetCursorPos(point.X, point.Y)) return false;
        mouse_event(right ? 0x08u : 0x02u, 0, 0, 0, UIntPtr.Zero);
        mouse_event(right ? 0x10u : 0x04u, 0, 0, 0, UIntPtr.Zero);
        return true;
    }

    private static bool OpenOverflow(IntPtr taskbar, IntPtr notify)
    {
        if (notify != IntPtr.Zero)
        {
            IntPtr button = Child(notify, "Button");
            return button != IntPtr.Zero && IsWindowVisible(button) && PostMessage(button, 0x00f5, IntPtr.Zero, IntPtr.Zero);
        }
        AutomationElement root = AutomationElement.FromHandle(taskbar);
        var chevron = root.FindFirst(TreeScope.Descendants, new OrCondition(
            new PropertyCondition(AutomationElement.ClassNameProperty, "SystemTray.ChevronIconView"),
            new PropertyCondition(AutomationElement.AutomationIdProperty, "SystemTrayIconOverflowButton")));
        if (chevron == null) return false;
        object pattern;
        if (chevron.TryGetCurrentPattern(InvokePattern.Pattern, out pattern))
        {
            ((InvokePattern)pattern).Invoke();
            return true;
        }
        return TryClick(taskbar, chevron.Current.BoundingRectangle, false);
    }

    public static Result Run(string id, string name, bool right)
    {
        SetThreadDpiAwarenessContext(new IntPtr(-4));
        IntPtr taskbar = FindWindow("Shell_TrayWnd", null);
        if (taskbar == IntPtr.Zero) return null;
        IntPtr notify = Child(taskbar, "TrayNotifyWnd");
        bool classic = Child(Child(notify, "SysPager"), "ToolbarWindow32") != IntPtr.Zero;
        if (!classic) notify = IntPtr.Zero;
        bool restoreTaskbar = !IsWindowVisible(taskbar);
        IntPtr overflow = Overflow(classic);
        bool restoreOverflow = overflow == IntPtr.Zero || !IsWindowVisible(overflow);
        POINT cursor;
        bool restoreCursor = GetCursorPos(out cursor);
        bool activating = !String.IsNullOrEmpty(id);
        bool needsVisibleTray = !classic || activating;
        var result = new Result { Items = new List<Entry>() };
        try
        {
            if (needsVisibleTray && restoreTaskbar) ShowWindow(taskbar, 8);
            if (!activating || id.StartsWith("tray:", StringComparison.Ordinal))
            {
                if (classic) ReadToolbar(result.Items, taskbar, Child(notify, "SysPager"), "tray", !activating);
                else ReadModern(result.Items, taskbar, "tray");
            }
            if (!activating || id.StartsWith("overflow:", StringComparison.Ordinal))
            {
                if (needsVisibleTray && restoreOverflow && OpenOverflow(taskbar, notify))
                {
                    for (int attempt = 0; attempt < 15; attempt++)
                    {
                        Thread.Sleep(35);
                        overflow = Overflow(classic);
                        if (overflow != IntPtr.Zero && IsWindowVisible(overflow)) break;
                    }
                    if (overflow != IntPtr.Zero && IsWindowVisible(overflow))
                    {
                        if (activating) SetWindowPos(overflow, new IntPtr(-1), 0, 0, 0, 0, 0x53);
                        Thread.Sleep(150);
                    }
                }
                if (classic) ReadToolbar(result.Items, overflow, overflow, "overflow", !activating);
                else ReadModern(result.Items, overflow, "overflow");
            }
            if (!classic && !activating) ReadModernMetadata(result.Items);
            if (activating)
            {
                Entry entry = result.Items.FirstOrDefault(item => item.Id == id && item.Name == name);
                if (entry != null && TryClick(entry.Surface, entry.Bounds, right))
                {
                    result.Clicked = true;
                    Thread.Sleep(120);
                }
            }
            return result;
        }
        finally
        {
            if (restoreOverflow && overflow != IntPtr.Zero && IsWindowVisible(overflow)) ShowWindow(overflow, 0);
            if (restoreTaskbar && IsWindowVisible(taskbar)) ShowWindow(taskbar, 0);
            if (restoreCursor && !(result.Clicked && right))
            {
                POINT current;
                if (GetCursorPos(out current) && (current.X != cursor.X || current.Y != cursor.Y))
                    SetCursorPos(cursor.X, cursor.Y);
            }
        }
    }
}
'@

[OpenBarTray]::Run($request.id, $request.name, [bool] $request.right) | ConvertTo-Json -Depth 4 -Compress
