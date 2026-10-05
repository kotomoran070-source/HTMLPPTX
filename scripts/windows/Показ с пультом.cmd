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
# Подключение телефона — как в plugins/remote-relay.mjs: одноразовый код из QR → пропуск (cookie);
# без пропуска из сети не отдаётся ничего. Отключить — в окне с QR; закрыли показ — пропуска гаснут
$tickets = @{}          # одноразовый код → комната, куда вести, срок
$devices = @{}          # ключ пропуска → телефон
$hostConns = @{}        # комната → потоки окна показа (с этого компьютера)
$hostGone = @{}         # комната → когда ушло последнее окно показа
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
$ROOM = '^[a-z0-9]{8,40}$'
$MAX_BODY = 262144

function Send-Response($s, [int]$code, [string]$type, [byte[]]$body, [string]$status = 'OK') {
  $h = "HTTP/1.1 $code $status`r`nContent-Type: $type`r`nContent-Length: $($body.Length)`r`nCache-Control: no-store`r`nConnection: close`r`n`r`n"
  $hb = $utf8.GetBytes($h)
  try { $s.Write($hb, 0, $hb.Length); if ($body.Length) { $s.Write($body, 0, $body.Length) }; $s.Flush() } catch {}
}
function Send-Json($s, [int]$code, $obj) { Send-Response $s $code 'application/json; charset=utf-8' ($utf8.GetBytes(($obj | ConvertTo-Json -Compress))) }
function Send-Text($s, [int]$code, [string]$t) { Send-Response $s $code 'text/plain; charset=utf-8' ($utf8.GetBytes($t)) }

function Send-Html($s, [int]$code, [string]$why) {
  $html = "<!doctype html><html lang=ru><meta charset=utf-8><meta name=viewport content=""width=device-width,initial-scale=1""><title>Пульт Slideria</title>" +
    "<body style=""margin:0;min-height:100vh;display:grid;place-items:center;background:#F3F4F6;font:16px/1.5 system-ui,sans-serif;color:#111827"">" +
    "<main style=""max-width:340px;margin:24px;padding:24px;border-radius:18px;background:#fff;box-shadow:0 6px 24px rgba(15,23,42,.08)"">" +
    "<h1 style=""margin:0 0 8px;font-size:21px"">Пульт показа</h1><p style=""margin:0;color:#4B5563"">$why</p>" +
    "<p style=""margin:14px 0 0;font-size:14px;color:#6B7280"">Подключиться снова: на компьютере окно докладчика → кнопка с телефоном (или клавиша R), затем отсканируйте новый QR.</p></main></body></html>"
  Send-Response $s $code 'text/html; charset=utf-8' ($utf8.GetBytes($html)) $(if ($code -eq 403) { 'Forbidden' } else { 'OK' })
}
function New-Token([int]$n) {
  $b = New-Object byte[] $n; $rng.GetBytes($b)
  return [Convert]::ToBase64String($b).Replace('+', '-').Replace('/', '_').TrimEnd('=')
}
function Is-Local($c) { try { return [Net.IPAddress]::IsLoopback($c.Client.RemoteEndPoint.Address) } catch { return $false } }
function Get-Device([string]$head) {
  if ($head -match '(?im)^Cookie:.*?slideria_rc=([A-Za-z0-9_-]{16,64})') { return $devices[$Matches[1]] }
  return $null
}
function Device-Name([string]$head) {
  $ua = if ($head -match '(?im)^User-Agent:\s*(.+)$') { $Matches[1] } else { '' }
  $os = if ($ua -match 'iPhone') { 'iPhone' } elseif ($ua -match 'iPad') { 'iPad' } elseif ($ua -match 'Android') { 'Android' } elseif ($ua -match 'Windows') { 'Windows' } elseif ($ua -match 'Mac OS') { 'Mac' } else { 'Устройство' }
  $br = if ($ua -match 'YaBrowser') { 'Яндекс Браузер' } elseif ($ua -match 'SamsungBrowser') { 'Samsung Internet' } elseif ($ua -match 'Edg') { 'Edge' } elseif ($ua -match 'Firefox|FxiOS') { 'Firefox' } elseif ($ua -match 'CriOS|Chrome') { 'Chrome' } elseif ($ua -match 'Safari') { 'Safari' } else { 'браузер' }
  return "$os · $br"
}
# Отключить телефон: его поток получает revoked и закрывается, пропуск больше не действует
function Revoke-Device([string]$key) {
  $d = $devices[$key]
  if (-not $d) { return }
  $devices.Remove($key)
  $bye = $utf8.GetBytes("event: revoked`ndata: {}`n`n")
  foreach ($p in @($d.Conns)) {
    try { $ps = $p.GetStream(); $ps.Write($bye, 0, $bye.Length); $ps.Flush() } catch {}
    if ($rooms.ContainsKey($d.Room)) { [void]$rooms[$d.Room].Remove($p) }
    try { $p.Close() } catch {}
  }
}

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

  $local = Is-Local $c
  $dev = if ($local) { $null } else { Get-Device $head }
  if ($path.StartsWith('/__slideria/remote/')) {
    $what = $path.Substring(19)
    # Одноразовая ссылка из QR: код → пропуск (cookie) → пульт
    if ($what -eq 'pair' -and $method -eq 'GET') {
      $t = Get-Query $q 't'
      $tk = $tickets[$t]
      if (-not $tk -or $tk.Exp -lt [DateTime]::UtcNow) {
        if ($tk) { $tickets.Remove($t) }
        Send-Html $s 403 'Этот QR уже использован или устарел: каждый код подключает один телефон. Покажите новый код на компьютере.'
        return $false
      }
      $tickets.Remove($t)
      $key = New-Token 24
      $ip = ''
      try { $ip = $c.Client.RemoteEndPoint.Address.ToString() -replace '^::ffff:', '' } catch {}
      $devices[$key] = [pscustomobject]@{ Id = (New-Token 6); Room = $tk.Room; Name = (Device-Name $head); Ip = $ip; Since = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); Conns = [Collections.ArrayList]::new() }
      $h = $utf8.GetBytes("HTTP/1.1 302 Found`r`nSet-Cookie: slideria_rc=$key; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`r`nLocation: $($tk.Next)`r`nCache-Control: no-store`r`nContent-Length: 0`r`nConnection: close`r`n`r`n")
      try { $s.Write($h, 0, $h.Length); $s.Flush() } catch {}
      return $false
    }
    if ($what -eq 'ended') { Send-Html $s 200 '<b>Пульт отключён.</b> Сеанс завершили на компьютере или закрыли показ — заметки и слайды с этого телефона больше не видны.'; return $false }
    if ($what -eq 'info') {
      if (-not $local) { Send-Json $s 403 @{ error = 'Только с этого компьютера' }; return $false }
      Send-Json $s 200 @{ urls = @(Get-LanIps | ForEach-Object { "http://${_}:$port" }); localOnly = $false; firewall = $isWin }; return $false
    }
    $room = Get-Query $q 'room'
    if ($room -notmatch $ROOM) { Send-Json $s 400 @{ error = 'Неверный код комнаты' }; return $false }
    if ($what -eq 'whoami') { Send-Json $s 200 @{ ok = ($local -or ($dev -and $dev.Room -eq $room)) }; return $false }
    if (-not $local -and -not ($dev -and $dev.Room -eq $room)) { Send-Json $s 403 @{ error = 'Нет доступа: отсканируйте QR на компьютере'; revoked = $true }; return $false }
    if (@('open', 'devices', 'revoke') -contains $what) {
      if (-not $local) { Send-Json $s 403 @{ error = 'Только с этого компьютера' }; return $false }
      if ($what -eq 'open' -and $method -eq 'POST') {
        $next = '/'
        try { $j = $utf8.GetString($body) | ConvertFrom-Json; if ($j.next -match '^/(?!/)') { $next = $j.next } } catch {}
        foreach ($k in @($tickets.Keys)) { if ($tickets[$k].Room -eq $room) { $tickets.Remove($k) } }
        $t = New-Token 12
        $tickets[$t] = [pscustomobject]@{ Room = $room; Next = $next; Exp = [DateTime]::UtcNow.AddMinutes(5) }
        Send-Json $s 200 @{ ticket = $t; expires = 300000 }
        return $false
      }
      if ($what -eq 'devices') {
        $list = @($devices.Values | Where-Object { $_.Room -eq $room } | Sort-Object Since | ForEach-Object { @{ id = $_.Id; name = $_.Name; ip = $_.Ip; since = $_.Since; online = ($_.Conns.Count -gt 0) } })
        Send-Response $s 200 'application/json; charset=utf-8' ($utf8.GetBytes('{"devices":' + $(if ($list.Count) { ConvertTo-Json -InputObject $list -Compress -Depth 4 } else { '[]' }) + '}'))
        return $false
      }
      if ($what -eq 'revoke' -and $method -eq 'POST') {
        $id = Get-Query $q 'id'
        $n = 0
        foreach ($k in @($devices.Keys)) { $d = $devices[$k]; if ($d.Room -eq $room -and (-not $id -or $d.Id -eq $id)) { Revoke-Device $k; $n++ } }
        Send-Json $s 200 @{ revoked = $n }
        return $false
      }
    }
    if ($what -eq 'events' -and $method -eq 'GET') {
      $h = $utf8.GetBytes("HTTP/1.1 200 OK`r`nContent-Type: text/event-stream; charset=utf-8`r`nCache-Control: no-store`r`nConnection: keep-alive`r`nX-Accel-Buffering: no`r`n`r`n: ok`n`n")
      try { $s.Write($h, 0, $h.Length); $s.Flush() } catch { return $false }
      if (-not $rooms.ContainsKey($room)) { $rooms[$room] = [Collections.ArrayList]::new() }
      [void]$rooms[$room].Add($c)
      if ($dev) { [void]$dev.Conns.Add($c) }
      if ($local) {
        if (-not $hostConns.ContainsKey($room)) { $hostConns[$room] = [Collections.ArrayList]::new() }
        [void]$hostConns[$room].Add($c)
        $hostGone.Remove($room)
      }
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

  # Из сети — только телефону с пропуском: в файле показа есть заметки
  if (-not $local -and -not $dev) { Send-Html $s 403 'Отсканируйте QR на компьютере, чтобы подключиться к показу.'; return $false }

  # Кнопка «Разрешить в брандмауэре» в окне с QR — только с этого компьютера и со своей страницы
  if ($path -eq '/__htmlpptx/firewall' -and $method -eq 'POST') {
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
        foreach ($p in @($rooms[$k])) {
          try { $ps = $p.GetStream(); $ps.Write($ping, 0, $ping.Length); $ps.Flush() } catch {
            [void]$rooms[$k].Remove($p); try { $p.Close() } catch {}
            foreach ($d in @($devices.Values)) { [void]$d.Conns.Remove($p) }
            if ($hostConns.ContainsKey($k)) { [void]$hostConns[$k].Remove($p) }
          }
        }
        if (-not $rooms[$k].Count) { $rooms.Remove($k) }
      }
      # Окно показа закрыто дольше минуты — сеанс окончен, пропуска телефонов гаснут
      foreach ($k in @($hostConns.Keys)) {
        if ($hostConns[$k].Count) { continue }
        if (-not $hostGone.ContainsKey($k)) { $hostGone[$k] = [DateTime]::UtcNow; continue }
        if (([DateTime]::UtcNow - $hostGone[$k]).TotalSeconds -ge 60) {
          foreach ($dk in @($devices.Keys)) { if ($devices[$dk].Room -eq $k) { Revoke-Device $dk } }
          $hostConns.Remove($k); $hostGone.Remove($k)
        }
      }
    }
    if (-not $busy) { Start-Sleep -Milliseconds 8 }
  }
} finally {
  $listener.Stop()
}
