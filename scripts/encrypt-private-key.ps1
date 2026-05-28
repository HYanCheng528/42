$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$inputFile = Join-Path $root "data\private-key.input.txt"
$outputFile = Join-Path $root "data\private-key.dpapi"
$envFile = Join-Path $root ".env.local"

if (-not (Test-Path -LiteralPath $inputFile)) {
  throw "Missing $inputFile. Put your private key in that file first."
}

$privateKey = (Get-Content -Raw -LiteralPath $inputFile).Trim()
if (-not $privateKey) {
  throw "Private key file is empty."
}
$privateKey = ($privateKey -replace "^\uFEFF", "").Trim()
$privateKey = ($privateKey -replace "^PRIVATE_KEY\s*=\s*", "").Trim()
$privateKey = $privateKey.Trim('"', "'", " ", "`t", "`r", "`n")
if ($privateKey -notmatch "^(0x)?[0-9a-fA-F]{64}$") {
  $normalizedLength = ($privateKey -replace "^0x", "").Length
  throw "Private key must be 64 hex characters, with or without 0x. Current normalized length: $normalizedLength."
}
if (-not $privateKey.StartsWith("0x")) {
  $privateKey = "0x$privateKey"
}

New-Item -ItemType Directory -Force (Split-Path -Parent $outputFile) | Out-Null
$secure = ConvertTo-SecureString $privateKey -AsPlainText -Force
$secure | ConvertFrom-SecureString | Set-Content -Encoding ASCII -LiteralPath $outputFile

$env:TMP_PRIVATE_KEY_FOR_ADDRESS = $privateKey
try {
  $address = node --input-type=module -e "import { privateKeyToAccount } from 'viem/accounts'; console.log(privateKeyToAccount(process.env.TMP_PRIVATE_KEY_FOR_ADDRESS).address);"
} finally {
  Remove-Item Env:\TMP_PRIVATE_KEY_FOR_ADDRESS -ErrorAction SilentlyContinue
}

if (Test-Path -LiteralPath $envFile) {
  $envText = Get-Content -Raw -LiteralPath $envFile
} else {
  $envText = ""
}

if ($envText -match "(?m)^PRIVATE_KEY=") {
  $envText = $envText -replace "(?m)^PRIVATE_KEY=.*$", "PRIVATE_KEY="
} else {
  $envText += "`nPRIVATE_KEY=`n"
}

if ($envText -match "(?m)^WINDOWS_DPAPI_PRIVATE_KEY_FILE=") {
  $envText = $envText -replace "(?m)^WINDOWS_DPAPI_PRIVATE_KEY_FILE=.*$", "WINDOWS_DPAPI_PRIVATE_KEY_FILE=data/private-key.dpapi"
} else {
  $envText += "WINDOWS_DPAPI_PRIVATE_KEY_FILE=data/private-key.dpapi`n"
}

if ($envText -match "(?m)^WALLET_ADDRESS=") {
  $envText = $envText -replace "(?m)^WALLET_ADDRESS=.*$", "WALLET_ADDRESS=$address"
} else {
  $envText += "WALLET_ADDRESS=$address`n"
}

Set-Content -LiteralPath $envFile -Value $envText.TrimStart() -Encoding UTF8
Remove-Item -LiteralPath $inputFile -Force

Write-Output "Encrypted private key saved to data/private-key.dpapi"
Write-Output "Wallet address written to .env.local: $address"
Write-Output "Deleted plaintext input file: data/private-key.input.txt"
