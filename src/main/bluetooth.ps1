$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$result = @{ status = 'unavailable'; devices = $null; error = $null }

function Test-BluetoothAccessDenied($record) {
    for ($exception = $record.Exception; $null -ne $exception; $exception = $exception.InnerException) {
        if ($exception.HResult -eq -2147024891) { return $true }
    }
    return $false
}

function Wait-BluetoothOperation($operation, [Type]$type) {
    $task = $asTask.MakeGenericMethod($type).Invoke($null, @($operation))
    return $task.GetAwaiter().GetResult()
}

try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $null = [Windows.Devices.Radios.Radio, Windows.System.Devices, ContentType=WindowsRuntime]
    $null = [Windows.Devices.Radios.RadioState, Windows.System.Devices, ContentType=WindowsRuntime]
    $null = [Windows.Devices.Radios.RadioAccessStatus, Windows.System.Devices, ContentType=WindowsRuntime]
    $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and $_.GetParameters().Count -eq 1 -and
        $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    } | Select-Object -First 1
    $radios = @(Wait-BluetoothOperation ([Windows.Devices.Radios.Radio]::GetRadiosAsync()) ([System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]]) |
        Where-Object { $_.Kind -eq 'Bluetooth' })
    if (!$radios.Count) { $result.status = 'no-adapter' }
    elseif ($radios.Count -gt 1) { $result.status = 'multiple' }
    else {
        $radio = $radios[0]
        $result.status = $radio.State.ToString().ToLowerInvariant()
        if ($operation -ne 'read' -and $result.status -in 'on', 'off' -and $operation -ne $result.status) {
            $access = Wait-BluetoothOperation ([Windows.Devices.Radios.Radio]::RequestAccessAsync()) ([Windows.Devices.Radios.RadioAccessStatus])
            if ($access -ne 'Allowed') { $result.error = 'denied' }
            else {
                $target = [Windows.Devices.Radios.RadioState]$operation
                $access = Wait-BluetoothOperation ($radio.SetStateAsync($target)) ([Windows.Devices.Radios.RadioAccessStatus])
                if ($access -ne 'Allowed') { $result.error = 'denied' }
                else {
                    for ($i = 0; $i -lt 10 -and $radio.State -ne $target; $i++) { Start-Sleep -Milliseconds 100 }
                    if ($radio.State -ne $target) { $result.error = 'unconfirmed' }
                }
            }
            $result.status = $radio.State.ToString().ToLowerInvariant()
        }
    }
} catch {
    if (Test-BluetoothAccessDenied $_) {
        if ($result.status -in 'on', 'off') { $result.error = 'denied' }
        else { $result.status = 'denied' }
    } elseif ($operation -ne 'read') { $result.error = 'failed' }
}

if ($result.status -in 'on', 'off', 'multiple', 'disabled') {
    try {
        $null = [Windows.Devices.Bluetooth.BluetoothDevice, Windows.Devices.Bluetooth, ContentType=WindowsRuntime]
        $null = [Windows.Devices.Bluetooth.BluetoothLEDevice, Windows.Devices.Bluetooth, ContentType=WindowsRuntime]
        $null = [Windows.Devices.Enumeration.DeviceInformation, Windows.Devices.Enumeration, ContentType=WindowsRuntime]
        $null = [Windows.Devices.Enumeration.DeviceInformationCollection, Windows.Devices.Enumeration, ContentType=WindowsRuntime]
        $null = [Windows.Devices.Enumeration.DeviceInformationKind, Windows.Devices.Enumeration, ContentType=WindowsRuntime]
        $addressProperty = 'System.Devices.Aep.DeviceAddress'
        $connectedProperty = 'System.Devices.Aep.IsConnected'
        $selectors = @(
            [Windows.Devices.Bluetooth.BluetoothDevice]::GetDeviceSelectorFromPairingState($true)
            [Windows.Devices.Bluetooth.BluetoothLEDevice]::GetDeviceSelectorFromPairingState($true)
        )
        $paired = @{}
        foreach ($selector in $selectors) {
            $query = [Windows.Devices.Enumeration.DeviceInformation]::FindAllAsync(
                $selector, [string[]]@($addressProperty, $connectedProperty),
                [Windows.Devices.Enumeration.DeviceInformationKind]::AssociationEndpoint)
            foreach ($device in (Wait-BluetoothOperation $query ([Windows.Devices.Enumeration.DeviceInformationCollection]))) {
                if (!$device.Name) { continue }
                $key = $device.Properties[$addressProperty]
                if (!$key) { $key = $device.Id }
                $connected = $device.Properties[$connectedProperty]
                $previous = $paired[$key]
                if (!$previous -or ($previous.connected -ne $true -and $connected -eq $true) -or
                    ($null -eq $previous.connected -and $null -ne $connected)) {
                    $paired[$key] = @{ name = $device.Name; connected = $connected }
                }
            }
        }
        $result.devices = @($paired.Values | Sort-Object { if ($_.connected -eq $true) { 0 } else { 1 } }, { $_.name })
    } catch {}
}
$result | ConvertTo-Json -Depth 4 -Compress
