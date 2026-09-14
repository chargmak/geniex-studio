$g = "$env:LOCALAPPDATA\GenieX CLI\geniex.exe"
$sc = $PSScriptRoot
$lib = "$env:APPDATA\GenieX Studio\sidecar\.venv\Lib\site-packages\qai_appbuilder\libs"

function RunInfer($tag, $extra) {
  $out = "$sc\t1-$tag.out"; $err = "$sc\t1-$tag.err"
  $argv = @('infer', 'qualcomm/Qwen3-0.6B', '-p', '"Say hello in five words."', '--think=false', '--max-tokens', '32', '--log', 'info', '--skip-update') + $extra
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $p = Start-Process -FilePath $g -ArgumentList $argv -NoNewWindow -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
  $done = $p.WaitForExit(240000)
  if (-not $done) { $p.Kill(); "TIMEOUT after 240 s" }
  "=== ${tag}: exit=$($p.ExitCode) (0x$('{0:X8}' -f $p.ExitCode)) in $([int]$sw.Elapsed.TotalSeconds)s ==="
  "--- stdout (tail) ---"; Get-Content $out -Tail 20
  "--- stderr (filtered) ---"; Get-Content $err | Select-String -Pattern 'DSP_INFO|UNSUPPORTED|error|fatal|panic|qairt|QNN|Hexagon|htp|load|version' -CaseSensitive:$false | Select-Object -First 40
}

# (bundled run already done)
RunInfer 'sidecar248' @('--qairt-lib', ('"' + $lib + '"'))
