<# : batch part - runs PowerShell below
@echo off
chcp 65001 >nul
set "SLIDERIA_SELF=%~f0"
set "SLIDERIA_ARG=%~f1"
powershell -NoProfile -ExecutionPolicy Bypass -Command "iex ([IO.File]::ReadAllText($env:SLIDERIA_SELF, [Text.Encoding]::UTF8))"
if errorlevel 1 pause
exit /b
#>

# ---------------------------------------------------------------------------------------------
# Показ с пультом — запасной способ без Node и без установки (Windows 10/11, встроенный PowerShell).
#
#  • Положите рядом с презентацией (.html из Slideria) и запустите двойным щелчком —
#    или перетащите файл презентации на этот файл.
#  • Откроется показ; нажмите R (или кнопку с телефоном в окне докладчика) — появится QR для телефона.
#  • Телефон и компьютер — в одной Wi-Fi. Остановить — закрыть это окно.
#
# Что делает: раздаёт презентацию в локальной сети и пересылает сообщения пульта
# (как yarn present, см. plugins/remote-relay.mjs). Брандмауэр сам не трогает: если телефон
# не подключается, в окне с QR есть кнопка «Разрешить в брандмауэре» — она один раз разрешает
# порты 5173–5199 только для локальной сети (запрос администратора), отключать его не нужно.
# ---------------------------------------------------------------------------------------------

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
$Host.UI.RawUI.WindowTitle = 'Slideria — показ с пультом'

function Say($t, $c = 'Gray') { Write-Host $t -ForegroundColor $c }
function Fail($t) { Say "`n  $t`n" 'Red'; Read-Host '  Нажмите Enter, чтобы закрыть' | Out-Null; exit 1 }

# ---------------- какая презентация
$self = $env:SLIDERIA_SELF
$arg = $env:SLIDERIA_ARG
if ($arg -and (Test-Path -LiteralPath $arg -PathType Leaf)) {
  $dir = [IO.Path]::GetDirectoryName($arg)
  $main = [IO.Path]::GetFileName($arg)
} else {
  $dir = if ($self) { [IO.Path]::GetDirectoryName($self) } else { (Get-Location).Path }
  $main = $null
}
$files = @(Get-ChildItem -LiteralPath $dir -File | Where-Object { $_.Extension -match '^\.html?$' } | Sort-Object Name | ForEach-Object { $_.Name })
if (-not $files.Count) { Fail "Рядом нет презентации (.html). Положите этот файл в папку с презентацией или перетащите презентацию на него." }
if (-not $main -and $files.Count -eq 1) { $main = $files[0] }

# ---------------- брандмауэр Windows: проверка без запросов; исправление — по кнопке в окне с QR
$RULE = 'Slideria remote'
$PORTS = '5173-5199'
$psExe = (Get-Process -Id $PID).Path
function Test-Firewall {
  try {
    $r = @(Get-NetFirewallRule -DisplayName $RULE -ErrorAction SilentlyContinue | Where-Object { $_.Enabled -eq 'True' -and $_.Action -eq 'Allow' })
    $ok = $false
    if ($r.Count -ge 1) { $p = $r | Get-NetFirewallPortFilter; if (@($p.LocalPort) -contains $PORTS) { $ok = $true } }
    $b = @(Get-NetFirewallApplicationFilter -Program $psExe -ErrorAction SilentlyContinue | Get-NetFirewallRule | Where-Object { $_.Enabled -eq 'True' -and $_.Action -eq 'Block' -and $_.Direction -eq 'Inbound' }).Count
    return ($ok -and $b -eq 0)
  } catch { return $true } # проверить нельзя (старая Windows) — не мешаем
}
function Fix-Firewall {
  $fix = @"
Remove-NetFirewallRule -DisplayName '$RULE' -ErrorAction SilentlyContinue
New-NetFirewallRule -DisplayName '$RULE' -Direction Inbound -Action Allow -Protocol TCP -LocalPort $PORTS -RemoteAddress LocalSubnet -Profile Any | Out-Null
Get-NetFirewallApplicationFilter -Program '$($psExe -replace "'", "''")' -ErrorAction SilentlyContinue | Get-NetFirewallRule | Where-Object { `$_.Action -eq 'Block' -and `$_.Direction -eq 'Inbound' } | Disable-NetFirewallRule
"@
  $enc = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($fix))
  try { Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile', '-EncodedCommand', $enc } catch { return 'declined' }
  if (Test-Firewall) { Say '  Брандмауэр: пульт разрешён в локальной сети — больше спрашивать не будет.' 'Green'; return 'fixed' }
  Say '  Брандмауэр: разрешение не получено — телефон может не подключиться.' 'Red'
  return 'error'
}
$isWin = $env:OS -eq 'Windows_NT'
$fwOk = (-not $isWin) -or (Test-Firewall)

# ---------------- адреса этого компьютера в сети: самый вероятный для телефона — первым
function Get-LanIps {
  $virtual = 'vEthernet|WSL|Hyper-V|VirtualBox|VMware|vboxnet|docker|veth|Loopback|Bluetooth|tailscale|zerotier|wireguard|VPN|Hamachi|Radmin|npcap'
  $list = @()
  try {
    foreach ($a in Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop) {
      $ip = $a.IPAddress; $name = [string]$a.InterfaceAlias
      if ($ip -match '^(127\.|169\.254\.)' -or $name -match $virtual) { continue }
      $s = 0
      if ($name -match 'Wi-?Fi|WLAN|Wireless|Беспровод') { $s += 40 } elseif ($name -match '^Ethernet') { $s += 15 }
      if ($ip -like '192.168.*') { $s += 30 } elseif ($ip -like '10.*') { $s += 20 } elseif ($ip -match '^172\.(1[6-9]|2\d|3[01])\.') { $s += 10 }
      $list += [pscustomobject]@{ Ip = $ip; Score = $s }
    }
  } catch {
    foreach ($ip in [Net.Dns]::GetHostAddresses([Net.Dns]::GetHostName())) {
      if ($ip.AddressFamily -eq 'InterNetwork' -and $ip.ToString() -notmatch '^(127\.|169\.254\.)') { $list += [pscustomobject]@{ Ip = $ip.ToString(); Score = 0 } }
    }
  }
  return @($list | Sort-Object Score -Descending | ForEach-Object { $_.Ip })
}

# ---------------- сервер
$listener = $null
$port = 5180
for (; $port -le 5199; $port++) {
  try { $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Any, $port); $listener.Start(); break } catch { $listener = $null }
}
if (-not $listener) { Fail 'Порты 5180–5199 заняты — закройте другой показ и запустите снова.' }

$utf8 = [Text.UTF8Encoding]::new($false)
$rooms = @{}            # код комнаты → список потоков SSE
$pending = [Collections.ArrayList]::new()
$ROOM = '^[a-z0-9]{8,40}$'
$MAX_BODY = 262144

function Send-Response($s, [int]$code, [string]$type, [byte[]]$body, [string]$status = 'OK') {
  $h = "HTTP/1.1 $code $status`r`nContent-Type: $type`r`nContent-Length: $($body.Length)`r`nCache-Control: no-store`r`nConnection: close`r`n`r`n"
  $hb = $utf8.GetBytes($h)
  try { $s.Write($hb, 0, $hb.Length); if ($body.Length) { $s.Write($body, 0, $body.Length) }; $s.Flush() } catch {}
}
function Send-Json($s, [int]$code, $obj) { Send-Response $s $code 'application/json; charset=utf-8' ($utf8.GetBytes(($obj | ConvertTo-Json -Compress))) }
function Send-Text($s, [int]$code, [string]$t) { Send-Response $s $code 'text/plain; charset=utf-8' ($utf8.GetBytes($t)) }

function Get-Query([string]$q, [string]$key) {
  foreach ($part in $q.Split('&')) { $kv = $part.Split('=', 2); if ($kv[0] -eq $key -and $kv.Count -eq 2) { return [Uri]::UnescapeDataString($kv[1]) } }
  return ''
}

function List-Page {
  $items = ($files | ForEach-Object { "<a href=""/$([Uri]::EscapeDataString($_))"">$([Net.WebUtility]::HtmlEncode($_))</a>" }) -join ''
  return "<!doctype html><meta charset=utf-8><meta name=viewport content=""width=device-width,initial-scale=1""><title>Slideria — показ</title>" +
    "<style>body{font:16px system-ui,sans-serif;background:#F6F7FB;color:#111827;display:grid;place-items:center;min-height:100vh;margin:0}main{width:min(520px,92vw)}h1{font-size:22px}a{display:block;padding:14px 18px;margin:8px 0;border-radius:14px;background:#fff;border:1px solid #E5E7EB;color:#3730A3;font-weight:600;text-decoration:none}a:hover{border-color:#A5B4FC}</style>" +
    "<main><h1>Какую презентацию показать?</h1>$items</main>"
}

# Обработка запроса; $true — соединение остаётся открытым (поток событий)
function Handle($c, [string]$head, [byte[]]$body) {
  $s = $c.GetStream()
  $line = ($head -split "`r`n")[0]
  $parts = $line.Split(' ')
  if ($parts.Count -lt 2) { Send-Text $s 400 'Bad request'; return $false }
  $method = $parts[0]
  $target = $parts[1]
  $q = ''
  $i = $target.IndexOf('?')
  if ($i -ge 0) { $q = $target.Substring($i + 1); $target = $target.Substring(0, $i) }
  $path = [Uri]::UnescapeDataString($target)

  if ($path.StartsWith('/__slideria/remote/')) {
    $what = $path.Substring(19)
    if ($what -eq 'info') { Send-Json $s 200 @{ urls = @(Get-LanIps | ForEach-Object { "http://${_}:$port" }); localOnly = $false; firewall = $isWin }; return $false }
    $room = Get-Query $q 'room'
    if ($room -notmatch $ROOM) { Send-Json $s 400 @{ error = 'Неверный код комнаты' }; return $false }
    if ($what -eq 'events' -and $method -eq 'GET') {
      $h = $utf8.GetBytes("HTTP/1.1 200 OK`r`nContent-Type: text/event-stream; charset=utf-8`r`nCache-Control: no-store`r`nConnection: keep-alive`r`nX-Accel-Buffering: no`r`n`r`n: ok`n`n")
      try { $s.Write($h, 0, $h.Length); $s.Flush() } catch { return $false }
      if (-not $rooms.ContainsKey($room)) { $rooms[$room] = [Collections.ArrayList]::new() }
      [void]$rooms[$room].Add($c)
      return $true
    }
    if ($what -eq 'send' -and $method -eq 'POST') {
      $text = $utf8.GetString($body).Trim()
      if (-not ($text.StartsWith('{') -or $text.StartsWith('['))) { Send-Json $s 400 @{ error = 'Не JSON' }; return $false }
      $msg = $utf8.GetBytes("data: $($text -replace '[\r\n]+', ' ')`n`n")
      $peers = 0
      if ($rooms.ContainsKey($room)) {
        foreach ($p in @($rooms[$room])) {
          try { $ps = $p.GetStream(); $ps.Write($msg, 0, $msg.Length); $ps.Flush(); $peers++ } catch { [void]$rooms[$room].Remove($p); try { $p.Close() } catch {} }
        }
      }
      Send-Json $s 200 @{ ok = $true; peers = $peers }
      return $false
    }
    Send-Json $s 404 @{ error = 'Неизвестный запрос' }
    return $false
  }

  # Кнопка «Разрешить в брандмауэре» в окне с QR — только с этого компьютера и со своей страницы
  if ($path -eq '/__htmlpptx/firewall' -and $method -eq 'POST') {
    $local = $false
    try { $local = [Net.IPAddress]::IsLoopback($c.Client.RemoteEndPoint.Address) } catch {}
    $origin = if ($head -match '(?im)^Origin:\s*(\S+)') { $Matches[1] } else { '' }
    if (-not $local -or ($origin -and $origin -notmatch "^http://(localhost|127\.0\.0\.1):$port$")) { Send-Json $s 403 @{ error = 'Только с этого компьютера' }; return $false }
    $state = if ($isWin) { Fix-Firewall } else { 'fixed' }
    Send-Json $s 200 @{ state = $state }
    return $false
  }
  if ($method -ne 'GET' -and $method -ne 'HEAD') { Send-Text $s 405 'Только GET'; return $false }
  $name = $path.TrimStart('/')
  if ($name -eq '' -or $name -eq 'index.html') {
    if ($main) { $name = $main } else { Send-Response $s 200 'text/html; charset=utf-8' ($utf8.GetBytes((List-Page))); return $false }
  }
  # Только презентации из этой папки — без подпапок и выхода наружу
  if ($files -notcontains $name) { Send-Text $s 404 'Не найдено'; return $false }
  $bytes = [IO.File]::ReadAllBytes((Join-Path $dir $name))
  if ($method -eq 'HEAD') { $bytes = [byte[]]@() }
  Send-Response $s 200 'text/html; charset=utf-8' $bytes
  return $false
}

# ---------------- запуск
$lan = @(Get-LanIps)
$start = if ($main) { "http://localhost:$port/$([Uri]::EscapeDataString($main))" } else { "http://localhost:$port/" }
Say ''
Say "  Slideria — показ с пультом" 'Cyan'
Say "  Показ:   $start"
if ($lan.Count) { Say "  В сети:  http://$($lan[0]):$port/" } else { Say '  В сети:  нет подключения — телефон не сможет подключиться' 'Red' }
Say "  Папка:   $dir"
Say ''
Say '  В показе нажмите R (или кнопку с телефоном в окне докладчика) — появится QR для телефона.'
Say '  Телефон — в той же Wi-Fi. Остановить: закройте это окно.' 'DarkGray'
if (-not $fwOk) { Say '  Если телефон не открывает страницу — в окне с QR нажмите «Разрешить в брандмауэре».' 'DarkYellow' }
Say ''
if (-not $env:SLIDERIA_NO_OPEN) { try { Start-Process $start } catch {} }

$lastPing = [DateTime]::UtcNow
$ping = $utf8.GetBytes(": ping`n`n")
try {
  while ($true) {
    $busy = $false
    while ($listener.Pending()) {
      $c = $listener.AcceptTcpClient()
      $c.NoDelay = $true
      [void]$pending.Add([pscustomobject]@{ C = $c; Buf = [IO.MemoryStream]::new(); T = [DateTime]::UtcNow })
      $busy = $true
    }
    foreach ($r in @($pending)) {
      $c = $r.C
      try {
        if ($c.Available -gt 0) {
          $chunk = New-Object byte[] ([Math]::Min($c.Available, 65536))
          $n = $c.GetStream().Read($chunk, 0, $chunk.Length)
          $r.Buf.Write($chunk, 0, $n)
          $busy = $true
        }
        $all = $r.Buf.ToArray()
        $text = [Text.Encoding]::ASCII.GetString($all)
        $end = $text.IndexOf("`r`n`r`n")
        if ($end -ge 0) {
          $head = $utf8.GetString($all, 0, $end)
          $len = 0
          if ($head -match '(?im)^Content-Length:\s*(\d+)') { $len = [int]$Matches[1] }
          if ($len -gt $MAX_BODY) { Send-Text $c.GetStream() 413 'Слишком большой запрос'; $pending.Remove($r); $c.Close(); continue }
          if ($all.Length -ge $end + 4 + $len) {
            $body = New-Object byte[] $len
            [Array]::Copy($all, $end + 4, $body, 0, $len)
            $pending.Remove($r)
            $keep = Handle $c $head $body
            if (-not $keep) { $c.Close() }
            continue
          }
        }
        if (([DateTime]::UtcNow - $r.T).TotalSeconds -gt 15) { $pending.Remove($r); $c.Close() }
      } catch { $pending.Remove($r); try { $c.Close() } catch {} }
    }
    # Без трафика соединение закрывают прокси и спящие телефоны
    if (([DateTime]::UtcNow - $lastPing).TotalSeconds -ge 15) {
      $lastPing = [DateTime]::UtcNow
      foreach ($k in @($rooms.Keys)) {
        foreach ($p in @($rooms[$k])) { try { $ps = $p.GetStream(); $ps.Write($ping, 0, $ping.Length); $ps.Flush() } catch { [void]$rooms[$k].Remove($p); try { $p.Close() } catch {} } }
        if (-not $rooms[$k].Count) { $rooms.Remove($k) }
      }
    }
    if (-not $busy) { Start-Sleep -Milliseconds 8 }
  }
} finally {
  $listener.Stop()
}
