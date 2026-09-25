// Whether the "Connect a phone" dialog is open. One dialog for the whole
// window, mounted by the left sidebar; anything that offers connecting a phone
// (the sidebar row, Settings → Bridge & mobile, the welcome tour) opens it here.

class ConnectPhoneUi {
  open = $state(false);

  show(): void {
    this.open = true;
  }
}

export const connectPhone = new ConnectPhoneUi();
