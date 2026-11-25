$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$request = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encodedRequest)) | ConvertFrom-Json
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, WindowsBase, Accessibility
Add-Type -ReferencedAssemblies UIAutomationClient, UIAutomationTypes, WindowsBase, Accessibility -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows;
using System.Windows.Automation;
using Accessibility;

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

    private static void ReadToolbar(List<Entry> entries, IntPtr surface, IntPtr parent, string section)
    {
        IntPtr toolbar = Child(parent, "ToolbarWindow32");
        if (toolbar == IntPtr.Zero) return;
        Guid iid = typeof(IAccessible).GUID;
        IAccessible accessible;
        if (AccessibleObjectFromWindow(toolbar, 0xfffffffc, ref iid, out accessible) != 0 || accessible == null) return;
        object[] children = new object[Math.Min(128, accessible.accChildCount)];
        int obtained;
        if (AccessibleChildren(accessible, 0, children.Length, children, out obtained) < 0) return;
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
                if (classic) ReadToolbar(result.Items, taskbar, Child(notify, "SysPager"), "tray");
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
                if (classic) ReadToolbar(result.Items, overflow, overflow, "overflow");
                else ReadModern(result.Items, overflow, "overflow");
            }
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
