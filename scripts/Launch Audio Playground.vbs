' Launch Audio Playground.vbs
' -----------------------------------------------------------------
'  Windowless entry point for the Desktop shortcut.
'
'  Fast path (everything already built): launches Electron directly
'  with NO console window at all -- the app just appears, like a
'  normal desktop program.
'
'  First run (deps/build missing): hands off to the .bat launcher in
'  a visible console so the user can watch the one-time setup
'  (npm install + production build, ~1 min) and see any errors.
'
'  Run via wscript (the default .vbs handler), which shows no console.
' -----------------------------------------------------------------

Set fso = CreateObject("Scripting.FileSystemObject")
Set sh  = CreateObject("WScript.Shell")

scriptDir   = fso.GetParentFolderName(WScript.ScriptFullName)
projectRoot = fso.GetParentFolderName(scriptDir)
logPath     = projectRoot & "\electron-launch.log"
batPath     = scriptDir & "\Launch Audio Playground.bat"

sh.CurrentDirectory = projectRoot

' Decide whether a one-time setup is still required.
needsSetup = False
If Not fso.FolderExists(projectRoot & "\node_modules") Then needsSetup = True
If Not fso.FileExists(projectRoot & "\dist\index.html") Then needsSetup = True
If Not fso.FileExists(projectRoot & "\dist-electron\main.js") Then needsSetup = True

If needsSetup Then
  ' Visible console so the user can watch first-time install + build.
  sh.Run "cmd /c """ & batPath & """", 1, False
  WScript.Quit 0
End If

' ---- Fast path: silent, windowless Electron launch ----
' Self-heal the CommonJS marker the main process needs (mirrors the .bat).
If fso.FileExists(projectRoot & "\dist-electron\main.js") _
   And Not fso.FileExists(projectRoot & "\dist-electron\package.json") Then
  On Error Resume Next
  Set pkg = fso.CreateTextFile(projectRoot & "\dist-electron\package.json", True)
  pkg.Write "{""type"":""commonjs""}"
  pkg.Close
  On Error Goto 0
End If

' Wipe the prior log so a stale run doesn't confuse diagnosis.
On Error Resume Next
If fso.FileExists(logPath) Then fso.DeleteFile logPath, True
On Error Goto 0

' window style 0 = hidden, bWaitOnReturn = False so we return immediately.
sh.Run "cmd /c npx --no-install electron . > """ & logPath & """ 2>&1", 0, False
WScript.Quit 0
