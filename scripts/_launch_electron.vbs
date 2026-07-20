' _launch_electron.vbs
' -----------------------------------------------------------------
'  Silently spawns Electron in the project root so the launcher
'  console window can close immediately after kicking off the app.
'  Captures stdout AND stderr to electron-launch.log so failures
'  can be diagnosed even though the spawn is hidden.
'  Invoked by Launch Audio Playground.bat - do not double-click directly.
' -----------------------------------------------------------------

Set fso = CreateObject("Scripting.FileSystemObject")
Set sh  = CreateObject("WScript.Shell")

scriptDir   = fso.GetParentFolderName(WScript.ScriptFullName)
projectRoot = fso.GetParentFolderName(scriptDir)
logPath     = projectRoot & "\electron-launch.log"

sh.CurrentDirectory = projectRoot

' Wipe the prior log so a stale run doesn't confuse diagnosis.
On Error Resume Next
If fso.FileExists(logPath) Then fso.DeleteFile logPath, True
On Error Goto 0

' window style 0 = hidden, bWaitOnReturn = False so we return immediately.
' Redirect stdout + stderr so any startup crash is captured.
sh.Run "cmd /c npx --no-install electron . > """ & logPath & """ 2>&1", 0, False
