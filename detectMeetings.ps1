# detectMeetings.ps1
# Persistent Daemon process using Windows UI Automation to find Microsoft Teams meeting windows.
# Optimized for performance (Daemon mode stdin/stdout + targeted ControlType queries).

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Perform-MeetingScan {
    $root = [Windows.Automation.AutomationElement]::RootElement
    $winCondition = New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ControlTypeProperty, [Windows.Automation.ControlType]::Window)
    $windows = $root.FindAll([Windows.Automation.TreeScope]::Children, $winCondition)

    $results = @()

    # Level 2 Optimization: Target only interactive controls (Button, Custom) instead of all TrueCondition descendants
    $btnCond = New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ControlTypeProperty, [Windows.Automation.ControlType]::Button)
    $customCond = New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ControlTypeProperty, [Windows.Automation.ControlType]::Custom)
    $targetControlsCondition = New-Object Windows.Automation.OrCondition($btnCond, $customCond)

    foreach ($win in $windows) {
        try {
            $name = $win.Current.Name
            $processId = $win.Current.ProcessId
            
            $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
            if ($process -and ($process.ProcessName -match "ms-teams|Teams|msteams")) {
                [Console]::Error.WriteLine("DEBUG: Analisando processo Teams: $($process.ProcessName) - Janela: $name")
                
                $isMeeting = $false
                
                # Fetch targeted control elements
                $elements = $win.FindAll([Windows.Automation.TreeScope]::Descendants, $targetControlsCondition)
                
                # Fallback for nested structure if needed
                if ($elements.Count -le 1) {
                    $childWindows = $win.FindAll([Windows.Automation.TreeScope]::Children, $winCondition)
                    foreach ($cWin in $childWindows) {
                        $elements += $cWin.FindAll([Windows.Automation.TreeScope]::Descendants, $targetControlsCondition)
                    }
                }

                foreach ($el in $elements) {
                    try {
                        $elName = $el.Current.Name
                        $automationId = $el.Current.AutomationId
                        
                        if ($elName -eq $name) { continue }

                        if ($elName -match "\b(Mudo|Mute|Microfone|Mic|Desligar|Hang up|Sair|Leave|Câmera|Camera|Ingressar|Join)\b" -or 
                            $automationId -match "hangup|mute|microphone|camera|join-button|call-controls") {
                            
                            if ($elName -match "^(Sair|Leave)$" -or $automationId -match "hangup|leave|mute|camera|microphone|join") {
                                 [Console]::Error.WriteLine("DEBUG: Reunião CONFIRMADA por controle: '$elName' (ID: $automationId)")
                                 $isMeeting = $true
                                 break
                            }

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

    if ($results.Count -eq 0) {
        return "[]"
    } else {
        if ($results.Count -eq 1) {
            return "[$($results[0] | ConvertTo-Json -Compress)]"
        } else {
            return ($results | ConvertTo-Json -Compress)
        }
    }
}

[Console]::Error.WriteLine("DEBUG: PowerShell Daemon iniciado e aguardando comandos")

# Daemon Mode Loop (Stdin -> Stdout)
while ($line = [Console]::ReadLine()) {
    if ($null -eq $line) { break }
    $trimmed = $line.Trim()
    
    if ($trimmed -eq "EXIT") {
        [Console]::Error.WriteLine("DEBUG: Recebido comando EXIT. Encerrando daemon PowerShell.")
        break
    }
    
    if ($trimmed -eq "SCAN") {
        try {
            $jsonOutput = Perform-MeetingScan
            [Console]::Out.WriteLine($jsonOutput)
            [Console]::Out.Flush()
        } catch {
            [Console]::Error.WriteLine("ERROR: Falha durante o scan: $($_.Exception.Message)")
            [Console]::Out.WriteLine("[]")
            [Console]::Out.Flush()
        }
    }
}
