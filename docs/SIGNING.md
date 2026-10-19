# Подпись приложения

Подпись — это отметка «собрал такой-то, и с тех пор файл не меняли». Windows показывает издателя вместо «Неизвестный издатель», а любая правка файла после сборки ломает подпись, и это видно. Код она не шифрует и не прячет, а только удостоверяет автора. Прячет и защищает от правки сама сборка: сжатый код, `app.asar` и проверка целостности, отпечаток для которой вшит в подписанный `Slideria.exe` ([PROTECTION.md](PROTECTION.md)).

`yarn app:build` подписывает `Slideria.exe`, `elevate.exe`, установщик и деинсталлятор. Алгоритм — SHA-256, к подписи добавляется метка времени DigiCert: после окончания срока сертификата подпись остаётся действительной. Для метки во время сборки нужен интернет.

Сертификат в проект не попадает: сборка берёт его из переменных окружения. Если переменных нет, установщик собирается без подписи, как раньше. Если сертификат задан, но подписать не получилось, сборка останавливается: неподписанный установщик случайно не проскочит.

| Переменная | Что это |
|---|---|
| `SLIDERIA_CERT_SHA1` | Отпечаток сертификата из хранилища Windows: сертификат на токене или импортированный один раз `.pfx`. Сам по себе не секрет: ключ остаётся в хранилище |
| `CSC_LINK` и `CSC_KEY_PASSWORD` | Файл `.pfx` (путь или содержимое в base64) и пароль к нему. Так сертификат передают в GitHub Actions |

## Какой сертификат

| Сертификат | Для чего | Что видно у других людей |
|---|---|---|
| Свой (самоподписанный), бесплатно | Проверить, что подпись работает | «Неизвестный издатель», как без подписи: ему доверяет только ваш компьютер |
| Сертификат подписи кода от центра сертификации (Sectigo, Certum, SSL.com и другие) | Раздавать программу | Ваше имя или название организации. Первое время SmartScreen ещё может предупреждать, пока у файла не накопится репутация |
| Облачная подпись: Azure Artifact Signing (бывший Trusted Signing) или облако центра сертификации | Подпись в GitHub Actions | То же, что у сертификата центра |

С 2023 года ключ к сертификату подписи кода выдают только на токене или в облаке центра сертификации, файлом `.pfx` его не получить. Токен вставляют в компьютер, сертификат появляется в хранилище Windows — дальше всё как в шагах ниже. Цены и то, в каких странах доступна облачная подпись, уточняйте у продавца.

## Подпись на своём компьютере

### 1. Сертификат

Для проверки подойдёт свой. В PowerShell (права администратора не нужны):

```powershell
$cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject "CN=Slideria Test" `
  -CertStoreLocation Cert:\CurrentUser\My -KeyAlgorithm RSA -KeyLength 3072 -HashAlgorithm SHA256 `
  -NotAfter (Get-Date).AddYears(3)
$cert.Thumbprint
```

Чтобы ваш компьютер ему доверял (только для проверки и только на своём компьютере):

```powershell
Export-Certificate -Cert $cert -FilePath "$env:TEMP\slideria-test.cer"
Import-Certificate -FilePath "$env:TEMP\slideria-test.cer" -CertStoreLocation Cert:\CurrentUser\Root
Import-Certificate -FilePath "$env:TEMP\slideria-test.cer" -CertStoreLocation Cert:\CurrentUser\TrustedPublisher
```

Windows спросит, установить ли корневой сертификат, — «Да». Убрать потом: `certmgr.msc` → «Доверенные корневые центры сертификации» и «Доверенные издатели» → «Slideria Test» → удалить.

Сертификат на токене: вставьте токен. Отпечаток покажет:

```powershell
Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert | Format-List Subject, Thumbprint
```

### 2. Отпечаток для сборки

Один раз:

```powershell
[Environment]::SetEnvironmentVariable('SLIDERIA_CERT_SHA1', 'отпечаток', 'User')
```

Откройте терминал заново, чтобы переменная появилась. Отпечаток можно скопировать и из окна сертификата («Состав» → «Отпечаток»): невидимый символ в начале и пробелы сборка убирает сама.

Вместо хранилища можно взять файл `.pfx` — только на время сеанса терминала, и пусть файл лежит вне папки проекта:

```powershell
$env:CSC_LINK = 'C:\keys\slideria.pfx'
$env:CSC_KEY_PASSWORD = 'пароль'
```

### 3. Сборка и проверка

```powershell
yarn app:build
```

Первая строка скажет, чем подписывается: «Подпись: сертификат … из хранилища Windows». С токеном драйвер может спросить PIN на каждый файл.

Проверка:

```powershell
Get-AuthenticodeSignature "dist-app\Slideria Setup 0.1.0.exe" | Format-List Status, StatusMessage, SignerCertificate, TimeStamperCertificate
```

- `Valid` — подпись в порядке, и компьютер ей доверяет.
- `UnknownError` и «…root certificate which is not trusted» — подпись в порядке, но сертификату этот компьютер не доверяет (свой сертификат без шага «доверять»).
- `NotSigned` — подписи нет; `HashMismatch` — файл меняли после подписи.

То же видно в проводнике: «Свойства» установщика → «Цифровые подписи».

## Потом: GitHub Actions

Сборке нужны те же переменные, только из секретов репозитория (Settings → Secrets and variables → Actions).

Файл `.pfx`. Свой сертификат из шага 1 сохраняют в файл и переводят в base64:

```powershell
Export-PfxCertificate -Cert $cert -FilePath C:\keys\slideria-test.pfx -Password (Read-Host -AsSecureString "Пароль")
[Convert]::ToBase64String([IO.File]::ReadAllBytes('C:\keys\slideria-test.pfx')) | Set-Clipboard
```

Скопированное — в секрет `WIN_CSC_LINK`, пароль — в `WIN_CSC_KEY_PASSWORD`. Шаг сборки:

```yaml
runs-on: windows-latest
steps:
  - uses: actions/checkout@v4
  - uses: actions/setup-node@v4
    with: { node-version: 20 }
  - run: yarn install --frozen-lockfile
  - run: yarn app:build
    env:
      CSC_LINK: ${{ secrets.WIN_CSC_LINK }}
      CSC_KEY_PASSWORD: ${{ secrets.WIN_CSC_KEY_PASSWORD }}
  - uses: actions/upload-artifact@v4
    with: { name: Slideria, path: dist-app/*.exe }
```

Токен в сервер GitHub не вставить, поэтому настоящий сертификат там — облачная подпись: Azure Artifact Signing (в electron-builder это `win.azureSignOptions`) или облако центра сертификации. Её подключают, когда сертификат уже выбран.
