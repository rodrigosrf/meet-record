export async function getAudioInputDevices() {
    try {
        // Request temporary mic permission if devices are unlabeled
        const devices = await navigator.mediaDevices.enumerateDevices();
        return devices.filter(device => device.kind === 'audioinput');
    } catch (error) {
        console.error("Error enumerating audio devices:", error);
        return [];
    }
}

export async function createMixedAudioStream({ systemStream, selectedDeviceId, includeMic = true }) {
    let audioCtx = null;
    let micStream = null;

    try {
        if (!includeMic || !selectedDeviceId || selectedDeviceId === 'none') {
            return {
                combinedStream: systemStream,
                cleanup: () => {}
            };
        }

        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const destination = audioCtx.createMediaStreamDestination();

        // 1. System Audio Track
        if (systemStream && systemStream.getAudioTracks().length > 0) {
            const systemSource = audioCtx.createMediaStreamSource(systemStream);
            systemSource.connect(destination);
        }

        // 2. Selected Microphone Track
        try {
            micStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    deviceId: { exact: selectedDeviceId },
                    echoCancellation: true,
                    noiseSuppression: true
                }
            });

            if (micStream && micStream.getAudioTracks().length > 0) {
                const micSource = audioCtx.createMediaStreamSource(micStream);
                micSource.connect(destination);
            }
        } catch (micError) {
            console.warn("Could not capture selected microphone:", micError);
        }

        // Combine Destination Audio Track + System Video Tracks (if video recording enabled)
        const combinedStream = new MediaStream();
        
        destination.stream.getAudioTracks().forEach(track => {
            combinedStream.addTrack(track);
        });

        if (systemStream && systemStream.getVideoTracks().length > 0) {
            systemStream.getVideoTracks().forEach(track => {
                combinedStream.addTrack(track);
            });
        }

        const cleanup = () => {
            if (micStream) {
                micStream.getTracks().forEach(t => t.stop());
            }
            if (audioCtx && audioCtx.state !== 'closed') {
                audioCtx.close();
            }
        };

        return { combinedStream, cleanup };

    } catch (error) {
        console.error("Error creating mixed audio stream:", error);
        return {
            combinedStream: systemStream,
            cleanup: () => {}
        };
    }
}
