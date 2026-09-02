[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Continue'

# Try a series of approaches that may work without UAC dialog cancellation
$logFile = "C:\Users\Tony\Desktop\livestream\h3-aigc-livestream\_wsl-install.log"

function Log($msg) {
    Write-Host $msg
    Add-Content -Path $logFile -Value $msg -Encoding UTF8
}

"=== Start $(Get-Date -Format 'o') ===" | Out-File -FilePath $logFile -Encoding UTF8

# Approach 1: Try wsl --install --no-distribution (already failed)
Log "[A1] Running wsl --install --no-distribution"
wsl --install --no-distribution 2>&1 | ForEach-Object { Log $_ }
Log "[A1] ExitCode=$LASTEXITCODE"

Log "=== End ==="