'use strict';

class PluginActivation {
  constructor() { this.state = 'idle'; this.viewRegistered = false; }
  begin() { if (this.state === 'loading' || this.state === 'loaded') return false; this.state = 'loading'; return true; }
  registered() { this.viewRegistered = true; this.state = 'loaded'; }
  failed() { this.state = 'idle'; this.viewRegistered = false; }
  unload(workspace, viewType) {
    if (this.viewRegistered && typeof workspace?.unregisterView === 'function') workspace.unregisterView(viewType);
    this.viewRegistered = false; this.state = 'idle';
  }
}
module.exports = { PluginActivation };
