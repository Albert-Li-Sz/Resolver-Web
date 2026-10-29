let pending = null;

// One confirmation belongs to one operation; a second request must not reuse it.
export function confirmAction({ title, message, confirmLabel = '确认载入' }) {
  if (pending) return Promise.resolve(false);
  const previousFocus = document.activeElement;
  const dialog = document.createElement('dialog');
  dialog.id = 'replacementDialog'; dialog.className = 'modal';
  dialog.setAttribute('aria-labelledby', 'replacementTitle');
  dialog.innerHTML = `<form method="dialog" class="modal-card">
    <div class="modal-head"><h2 id="replacementTitle"></h2><button type="submit" class="icon-btn" value="cancel" aria-label="关闭确认框">×</button></div>
    <p class="modal-message"></p>
    <div class="modal-actions"><button type="submit" class="btn btn-ghost" value="cancel" autofocus>取消</button><button type="submit" class="btn btn-primary" value="confirm"></button></div>
  </form>`;
  dialog.querySelector('h2').textContent = title;
  dialog.querySelector('.modal-message').textContent = message;
  dialog.querySelector('[value="confirm"]').textContent = confirmLabel;
  pending = dialog;
  document.body.append(dialog);
  return new Promise((resolve) => {
    const cancel = () => dialog.close('cancel');
    const finish = () => {
      window.removeEventListener('pagehide', cancel);
      pending = null; dialog.remove();
      if (previousFocus?.isConnected) previousFocus.focus();
      resolve(dialog.returnValue === 'confirm');
    };
    dialog.addEventListener('close', finish, { once: true });
    window.addEventListener('pagehide', cancel, { once: true });
    try { dialog.showModal(); }
    catch { dialog.returnValue = 'cancel'; finish(); }
  });
}
