param([int]$Port = 8080)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$lanBound = $false
try {
    $listener.Prefixes.Add("http://+:$Port/")
    $listener.Start()
    $lanBound = $true
} catch {
    $listener = New-Object System.Net.HttpListener
    $listener.Prefixes.Add("http://localhost:$Port/")
    $listener.Start()
}

$localIp = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } | Select-Object -First 1 -ExpandProperty IPAddress)

Write-Host ""
Write-Host "=================================================" -ForegroundColor Yellow
Write-Host "  냥이가르드 웹 프로토타입 로컬 서버 실행 중!" -ForegroundColor Green
Write-Host "  PC 접속:     http://localhost:$Port" -ForegroundColor Cyan
if ($lanBound -and $localIp) {
    Write-Host "  모바일 접속: http://${localIp}:$Port  (같은 Wi-Fi)" -ForegroundColor Cyan
} else {
    Write-Host "  (모바일 Wi-Fi 접속이 필요하면 관리자 권한으로 실행하거나 폴더를 Netlify Drop 등에 올려주세요)" -ForegroundColor DarkYellow
}
Write-Host "  종료하려면 Ctrl+C 또는 창을 닫으세요." -ForegroundColor Gray
Write-Host "=================================================" -ForegroundColor Yellow
Write-Host ""

$mime = @{
    ".html" = "text/html; charset=utf-8"
    ".css"  = "text/css; charset=utf-8"
    ".js"   = "application/javascript; charset=utf-8"
    ".png"  = "image/png"
    ".jpg"  = "image/jpeg"
    ".svg"  = "image/svg+xml"
    ".json" = "application/json"
}

try {
    while ($listener.IsListening) {
        $ctx = $listener.GetContext()
        $reqPath = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)
        if ($reqPath -eq "/") { $reqPath = "/index.html" }
        $rel = $reqPath.TrimStart("/").Replace("/", "\")
        $full = [IO.Path]::GetFullPath((Join-Path $root $rel))

        if ($full.StartsWith($root) -and (Test-Path $full -PathType Leaf)) {
            $ext = [IO.Path]::GetExtension($full).ToLower()
            $ctx.Response.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { "application/octet-stream" }
            $bytes = [IO.File]::ReadAllBytes($full)
            $ctx.Response.ContentLength64 = $bytes.Length
            $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $ctx.Response.StatusCode = 404
        }
        $ctx.Response.OutputStream.Close()
    }
} finally {
    $listener.Stop()
}
