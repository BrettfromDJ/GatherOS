const SERVER = 'http://127.0.0.1:53247';
const tokenInput = document.getElementById('token');
const saveBtn = document.getElementById('save');
const testBtn = document.getElementById('test');
const status = document.getElementById('status');

function setStatus(text, kind) {
  status.textContent = text;
  status.className = kind ? `status ${kind}` : 'status';
}

chrome.storage.local.get('token').then(({ token }) => {
  if (token) tokenInput.value = token;
});

saveBtn.addEventListener('click', async () => {
  const token = tokenInput.value.trim();
  await chrome.storage.local.set({ token });
  setStatus('Saved.', 'ok');
});

testBtn.addEventListener('click', async () => {
  setStatus('Checking…');
  try {
    const res = await fetch(`${SERVER}/ping`);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const json = await res.json();
    if (json.ok && json.app === 'GatherOS') {
      setStatus('Connected.', 'ok');
    } else {
      setStatus('Unexpected response.', 'err');
    }
  } catch {
    setStatus('Not reachable — is GatherOS running?', 'err');
  }
});
