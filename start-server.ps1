# Neon Audio Player - Local Wi-Fi & PC Web Server
# Zero dependencies, no admin rights required! Works on any Windows PC.

$port = 8080
$folder = $PSScriptRoot

# Find local Wi-Fi / LAN IP address
$localIp = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { 
    $_.InterfaceAlias -notmatch 'Loopback|vEthernet|Virtual' -and $_.IPAddress -notmatch '^169\.' 
} | Select-Object -First 1).IPAddress

if (-not $localIp) { $localIp = "127.0.0.1" }

$localUrl = "http://localhost:$port/"
$phoneUrl = "http://$($localIp):$port/"

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "       ⚡ NEON AUDIO PLAYER - ЛОКАЛЬНЫЙ СЕРВЕР ⚡" -ForegroundColor Magenta
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "💻 На этом компьютере: " -NoNewline -ForegroundColor White
Write-Host $localUrl -ForegroundColor Green
Write-Host "📱 На телефоне (в той же Wi-Fi сети): " -NoNewline -ForegroundColor White
Write-Host $phoneUrl -ForegroundColor Yellow
Write-Host ""
Write-Host "----------------------------------------------------------" -ForegroundColor DarkGray
Write-Host "Инструкция для телефона:" -ForegroundColor Gray
Write-Host " 1. Откройте на телефоне ссылку: $phoneUrl" -ForegroundColor Cyan
Write-Host " 2. В браузере выберите 'На экран Домой' (PWA) для установки." -ForegroundColor Gray
Write-Host " 3. Нажмите 'Демо' или добавьте свои аудиофайлы через кнопку." -ForegroundColor Gray
Write-Host "----------------------------------------------------------" -ForegroundColor DarkGray
Write-Host "Сервер активен. Нажмите Ctrl+C в этом окне для остановки." -ForegroundColor DarkGray
Write-Host ""

# MIME Types dictionary
$mimeTypes = @{
    ".html" = "text/html; charset=utf-8"
    ".css"  = "text/css; charset=utf-8"
    ".js"   = "application/javascript; charset=utf-8"
    ".json" = "application/json; charset=utf-8"
    ".webmanifest" = "application/manifest+json; charset=utf-8"
    ".svg"  = "image/svg+xml"
    ".png"  = "image/png"
    ".jpg"  = "image/jpeg"
    ".mp3"  = "audio/mpeg"
    ".wav"  = "audio/wav"
    ".ogg"  = "audio/ogg"
    ".flac" = "audio/flac"
    ".m4a"  = "audio/mp4"
}

$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Any, $port)
$listener.Start()

# Open default browser on PC
Start-Process $localUrl

try {
    while ($true) {
        $client = $listener.AcceptTcpClient()
        [System.Threading.ThreadPool]::QueueUserWorkItem([System.Threading.WaitCallback]{
            param($c)
            try {
                $stream = $c.GetStream()
                $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8)
                $firstLine = $reader.ReadLine()
                if (-not $firstLine) { $c.Close(); return }

                $parts = $firstLine.Split(" ")
                if ($parts.Length -lt 2) { $c.Close(); return }

                $method = $parts[0]
                $reqPath = $parts[1].Split("?")[0].TrimStart('/')
                if ([string]::IsNullOrEmpty($reqPath) -or $reqPath -eq "/") {
                    $reqPath = "index.html"
                }

                $reqPath = [System.Uri]::UnescapeDataString($reqPath)
                $filePath = Join-Path $using:folder $reqPath.Replace('/', [System.IO.Path]::DirectorySeparatorChar)

                if (Test-Path $filePath -PathType Leaf) {
                    $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
                    $mime = $using:mimeTypes[$ext]
                    if (-not $mime) { $mime = "application/octet-stream" }

                    $bytes = [System.IO.File]::ReadAllBytes($filePath)
                    $header = "HTTP/1.1 200 OK`r`n" +
                              "Content-Type: $mime`r`n" +
                              "Content-Length: $($bytes.Length)`r`n" +
                              "Access-Control-Allow-Origin: *`r`n" +
                              "Connection: close`r`n`r`n"
                    $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
                    $stream.Write($headerBytes, 0, $headerBytes.Length)
                    $stream.Write($bytes, 0, $bytes.Length)
                } else {
                    $nf = "404 Not Found"
                    $nfBytes = [System.Text.Encoding]::UTF8.GetBytes($nf)
                    $header = "HTTP/1.1 404 Not Found`r`n" +
                              "Content-Type: text/plain`r`n" +
                              "Content-Length: $($nfBytes.Length)`r`n" +
                              "Connection: close`r`n`r`n"
                    $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
                    $stream.Write($headerBytes, 0, $headerBytes.Length)
                    $stream.Write($nfBytes, 0, $nfBytes.Length)
                }
                $stream.Flush()
                $c.Close()
            } catch {
                if ($c) { $c.Close() }
            }
        }, $client) | Out-Null
    }
} finally {
    $listener.Stop()
}
