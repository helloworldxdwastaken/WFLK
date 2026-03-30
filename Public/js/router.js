/**
 * WFLK Audio Persistence
 * Keeps audio playing across page navigations using localStorage
 */

class WFLKAudioPersistence {
    constructor() {
        this.audioElement = null;
        this.init();
    }

    init() {
        // Find the audio element
        this.audioElement = document.getElementById('radioAudio') || document.querySelector('audio');
        
        if (this.audioElement) {
            // Restore audio state from localStorage
            this.restoreAudioState();
            
            // Save audio state periodically
            setInterval(() => this.saveAudioState(), 500);
            
            // Save state before page unload
            window.addEventListener('beforeunload', () => this.saveAudioState());
            
            // Listen for play/pause events
            this.audioElement.addEventListener('play', () => this.saveAudioState());
            this.audioElement.addEventListener('pause', () => this.saveAudioState());
            this.audioElement.addEventListener('volumechange', () => this.saveAudioState());
        }
    }
    
    saveAudioState() {
        if (this.audioElement) {
            const state = {
                playing: !this.audioElement.paused,
                volume: this.audioElement.volume,
                src: this.audioElement.src,
                currentTime: this.audioElement.currentTime,
                timestamp: Date.now()
            };
            localStorage.setItem('wflk-audio-state', JSON.stringify(state));
        }
    }
    
    restoreAudioState() {
        try {
            const stateStr = localStorage.getItem('wflk-audio-state');
            if (!stateStr) return;
            
            const state = JSON.parse(stateStr);
            if (!state) return;
            
            // Only restore if state is recent (within 30 seconds)
            const age = Date.now() - (state.timestamp || 0);
            if (age > 30000) return;
            
            // Restore volume
            if (typeof state.volume === 'number') {
                this.audioElement.volume = state.volume;
            }
            
            // Restore playback if was playing
            if (state.playing && state.src) {
                // Set the source if needed
                if (!this.audioElement.src || this.audioElement.src !== state.src) {
                    this.audioElement.src = state.src;
                }
                
                // Auto-play (may be blocked by browser)
                const playPromise = this.audioElement.play();
                if (playPromise) {
                    playPromise.catch(err => {
                        console.log('Auto-play blocked by browser:', err.message);
                    });
                }
            }
        } catch (e) {
            console.warn('Could not restore audio state:', e);
        }
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.wflkAudio = new WFLKAudioPersistence();
});
