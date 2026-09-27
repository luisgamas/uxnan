// Whether the Bridge window is open: the bridge's state and update, the
// devices connected to it, and the QR that connects a phone. One window for
// the whole app, mounted by the left sidebar; anything that offers connecting
// a phone (the sidebar's Bridge row, Settings → Bridge & mobile, the welcome
// tour) opens it here.

class BridgePanelUi {
  open = $state(false);

  show(): void {
    this.open = true;
  }
}

export const bridgePanel = new BridgePanelUi();
