# detectMeetings.ps1
# This script uses Windows UI Automation to find Microsoft Teams meeting windows.
# Optimized for performance and reliability.

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

# Set output encoding to UTF8 to avoid issues with special characters
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$root = [Windows.Automation.AutomationElement]::RootElement
# Only look for top-level windows
$winCondition = New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ControlTypeProperty, [Windows.Automation.ControlType]::Window)
$windows = $root.FindAll([Windows.Automation.TreeScope]::Children, $winCondition)

$results = @()

foreach ($win in $windows) {
    try {
        $name = $win.Current.Name
        $processId = $win.Current.ProcessId
        
        # Verify if the process is Microsoft Teams
        $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
        if ($process -and ($process.ProcessName -match "ms-teams|Teams|msteams")) {
            [Console]::Error.WriteLine("DEBUG: Analisando processo Teams: $($process.ProcessName) - Janela: $name")
            
            $isMeeting = $false
            
            # Rely entirely on deep check for Teams windows
            [Console]::Error.WriteLine("DEBUG: Iniciando busca profunda de controles em: $name")
            
            $condition = [Windows.Automation.Condition]::TrueCondition
            $elements = $win.FindAll([Windows.Automation.TreeScope]::Descendants, $condition)
            
            # If we only found the window itself, try to look for child windows (Teams v2 nested structure)
            if ($elements.Count -le 1) {
                $childWinCondition = New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ControlTypeProperty, [Windows.Automation.ControlType]::Window)
                $childWindows = $win.FindAll([Windows.Automation.TreeScope]::Children, $childWinCondition)
                foreach ($cWin in $childWindows) {
                    $elements += $cWin.FindAll([Windows.Automation.TreeScope]::Descendants, $condition)
                }
            }

            foreach ($el in $elements) {
                try {
                    $elName = $el.Current.Name
                    $automationId = $el.Current.AutomationId
                    
                    if ($elName -eq $name) { continue }

                    # Definitive Meeting/Call Controls
                    # We look for word boundaries to avoid matching "Chamada de áudio" as "Microfone"
                    if ($elName -match "\b(Mudo|Mute|Microfone|Mic|Desligar|Hang up|Sair|Leave|Câmera|Camera|Ingressar|Join)\b" -or 
                        $automationId -match "hangup|mute|microphone|camera|join-button|call-controls") {
                        
                        # Extra validation for 'Sair' to avoid 'Sair do grupo' in chat
                        if ($elName -match "^(Sair|Leave)$" -or $automationId -match "hangup|leave|mute|camera|microphone|join") {
                             [Console]::Error.WriteLine("DEBUG: Reunião CONFIRMADA por controle: '$elName' (ID: $automationId)")
                             $isMeeting = $true
                             break
                        }

                        # If it's a Mic/Camera toggle, it's a meeting
                        if ($elName -match "Mudo|Mute|Câmera|Camera|Microfone|Mic") {
                            [Console]::Error.WriteLine("DEBUG: Reunião CONFIRMADA por controle: '$elName'")
                            $isMeeting = $true
                            break
                        }
                    }
                } catch { continue }
            }
            
            if ($isMeeting) {
                $results += @{ title = $name; handle = $win.Current.NativeWindowHandle.ToString() }
            }
        }
    } catch {
        continue
    }
}

# Ensure we output a valid JSON array
if ($results.Count -eq 0) {
    Write-Output "[]"
} else {
    if ($results.Count -eq 1) {
        Write-Output "[$($results[0] | ConvertTo-Json -Compress)]"
    } else {
        $results | ConvertTo-Json -Compress
    }
}
