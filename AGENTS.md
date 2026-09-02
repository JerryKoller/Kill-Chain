\# Kill Chain — AI Agent Instructions



You are working on Kill Chain, a Windows Electron + React + TypeScript audio application.



\## PRIMARY OBJECTIVE



Improve Kill Chain safely, incrementally, and measurably.



Favor:

\- reproducible bug fixes

\- reliability

\- tests

\- error handling

\- memory/resource cleanup

\- maintainability

\- performance

\- documentation

\- small behavior-preserving refactors



Never make speculative changes simply because code "could be cleaner."



\## GIT SAFETY



This directory is an isolated AI Git worktree.



You may modify files only inside the current worktree.



NEVER:

\- run git push

\- merge branches

\- rebase branches

\- force-reset branches

\- delete branches

\- alter another worktree

\- rewrite Git history



Do not commit unless explicitly authorized.



\## AUDIO ARCHITECTURE — HARD INVARIANTS



1\. Only `rewireFront()` may mutate front routing gains.

2\. Only `claimSource()` may decide playback ownership.

3\. Only MISSION STATE may react to source changes.

4\. Live audio-tap nodes must be disconnected in `finally` blocks.

5\. Intervals and requestAnimationFrame loops must be cleaned up.

6\. Store writes and matching AudioEngine calls must occur in the same synchronous action.

7\. Persistence failures must call `reportStorageFailure`.

8\. Preserve the one-audible-source rule.

9\. Preserve the one-high-rate-FFT-pipeline design unless explicitly authorized otherwise.



\## MISSION STATE PRIORITY



manual override

> saved source memory

> Auto-Lock

> Auto-Flatten



Do not change this order without approval.



\## AUDIO BEHAVIOR REQUIRES APPROVAL



Do not autonomously alter:

\- DSP algorithms

\- EQ curves

\- correction profiles

\- gain staging

\- limiter/compressor behavior

\- transient processing

\- saturation

\- restoration algorithms

\- spatialization

\- 3D behavior

\- crossover behavior

\- loudness targets

\- preset tuning



You may investigate and propose such changes, but ask before implementing them.



\## MAJOR PRODUCT CHANGES REQUIRE APPROVAL



Do not autonomously:

\- remove features

\- redesign major UI flows

\- change persistence formats

\- add major dependencies

\- introduce new frameworks

\- change installer/release behavior

\- add major new features



\## VALIDATION



For normal changes run:



`npm run typecheck`



then:



`npm run build`



For critical audio, routing, playback, state, device, or export changes also run:



`npm run smoke`



Other diagnostics available when relevant:



`npm run distort-hunt`

`npm run leak-check`

`npm run project-repro`

`npm run soak`

`npm run heap-diff`



Never claim a test passed unless you actually ran it successfully.



\## WORK STYLE



Before changing code:



1\. Understand the task.

2\. Locate the relevant implementation.

3\. Read the surrounding architecture.

4\. Determine how current behavior is validated.

5\. Make the smallest reasonable change.

6\. Run appropriate validation.

7\. Review the diff.

8\. Report exactly what changed and what was tested.



Do not perform sweeping rewrites of large files.

Do not refactor unrelated code during a bug fix.

Investigate instead of guessing.



\## ENVIRONMENT AND EDITING DISCIPLINE


This project is developed on Windows. Shell commands must be compatible with Windows PowerShell.

Prefer PowerShell-native commands such as Get-ChildItem, Select-String, Get-Content, Test-Path, and Get-Item.

Do not assume Unix commands such as grep, find, head, tail, sed, awk, or bash are available.

If a shell command fails because of platform differences, adapt to PowerShell instead of changing the environment or installing tools.

Before editing a suspected bug, verify the hypothesis by rereading the exact failure path and relevant surrounding state transitions or callers.

Actively try to disprove the initial diagnosis before modifying code.

Clearly distinguish confirmed behavior from speculation.

Make the smallest possible diff.

Do not reformat, re-indent, rename, or otherwise alter unrelated code during a focused fix.

Preserve existing async semantics such as void, await, promise chaining, and error handling unless changing them is required by the task.

After every code edit, reread the changed block and inspect the Git diff before considering the edit complete.

Explicitly check for duplicate function calls, duplicated blocks, accidental formatting changes, removed operators or keywords, and unrelated modifications.

If a conversation has spent significant time under read-only or investigation-only instructions and the task changes to editing code, prefer starting a fresh OpenCode conversation before making the edit.

\## PROJECT REFERENCES



Before architectural changes read:



`docs/audio-state-machine.md`



For performance-sensitive audio work also read:



`docs/performance.md`



Treat those documents as authoritative unless explicitly told otherwise.

