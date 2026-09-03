# Kill Chain AI CLI — Windows PowerShell entrypoint
param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$CommandArgs
)
$cli = Join-Path $PSScriptRoot "src\cli.mjs"
& node $cli @CommandArgs
exit $LASTEXITCODE
