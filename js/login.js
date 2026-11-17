import { supabase } from './supabase.js';
import { ALLOWED_DOMAINS } from './config.js';
import { S } from './strings.js';
import { $, showAlert, clearAlerts, setBusy, ensureConfigured } from './ui.js';

const alerts = $('#alerts');
const emailForm = $('#email-form');
const codeForm = $('#code-form');
const emailInput = $('#email');
const codeInput = $('#code');
const resendBtn = $('#resend-btn');
let currentEmail = '';
let resendTimer = null;

function domainOk(email) {
  const parts = email.split('@');
  return parts.length === 2 && parts[0].length > 0 && ALLOWED_DOMAINS.includes(parts[1].toLowerCase());
}

function authErrorMessage(error) {
  const msg = String(error && error.message || '');
  if (error && (error.status === 429 || /rate limit|too many/i.test(msg))) return S.rateLimited;
  if (/pcc email|not allowed|hook|403/i.test(msg) || (error && error.status === 403)) return S.signupDenied;
  return null;
}

function startResendCountdown() {
  clearInterval(resendTimer);
  let left = 60;
  resendBtn.disabled = true;
  resendBtn.textContent = S.resendIn(left);
  resendTimer = setInterval(() => {
    left -= 1;
    if (left <= 0) {
      clearInterval(resendTimer);
      resendBtn.disabled = false;
      resendBtn.textContent = S.resend;
    } else {
      resendBtn.textContent = S.resendIn(left);
    }
  }, 1000);
}

async function sendCode(email, btn) {
  clearAlerts(alerts);
  setBusy(btn, true, S.sending);
  try {
    // Server-side hook + triggers enforce the domain; the check above is UX only.
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    if (error) { showAlert(alerts, authErrorMessage(error) || S.sendFailed); return false; }
    return true;
  } catch (e) {
    showAlert(alerts, S.networkError);
    return false;
  } finally {
    setBusy(btn, false);
  }
}

function showCodeStep() {
  emailForm.classList.add('hidden');
  codeForm.classList.remove('hidden');
  $('#sent-msg').textContent = S.codeSent(currentEmail);
  codeInput.value = '';
  codeInput.focus();
  startResendCountdown();
}

async function init() {
  if (!ensureConfigured()) return;
  $('#domain-hint').textContent = S.domainHint(ALLOWED_DOMAINS);
  const { data } = await supabase.auth.getSession();
  if (data.session) { location.replace('./play.html'); return; }

  emailForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = emailInput.value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { showAlert(alerts, S.badEmail); return; }
    if (email.split('@')[0].includes('+')) { showAlert(alerts, S.plusNotAllowed); return; }
    if (!domainOk(email)) { showAlert(alerts, S.badDomain(ALLOWED_DOMAINS)); return; }
    currentEmail = email;
    if (await sendCode(email, $('#send-btn'))) showCodeStep();
  });

  codeInput.addEventListener('input', () => { codeInput.value = codeInput.value.replace(/\D/g, '').slice(0, 6); });

  codeForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const token = codeInput.value.trim();
    if (!/^\d{6}$/.test(token)) { showAlert(alerts, S.badCode); return; }
    clearAlerts(alerts);
    const btn = $('#verify-btn');
    setBusy(btn, true, S.verifying);
    try {
      const { data: res, error } = await supabase.auth.verifyOtp({ email: currentEmail, token, type: 'email' });
      if (error || !res.session) {
        showAlert(alerts, authErrorMessage(error) || S.codeWrong);
        return;
      }
      location.replace('./play.html');
    } catch (err) {
      showAlert(alerts, S.networkError);
    } finally {
      setBusy(btn, false);
    }
  });

  resendBtn.addEventListener('click', async () => {
    resendBtn.disabled = true;
    if (await sendCode(currentEmail, resendBtn)) {
      showAlert(alerts, S.codeSent(currentEmail), 'success');
      startResendCountdown();
    } else {
      resendBtn.disabled = false;
    }
  });

  $('#change-btn').addEventListener('click', () => {
    clearInterval(resendTimer);
    clearAlerts(alerts);
    codeForm.classList.add('hidden');
    emailForm.classList.remove('hidden');
    emailInput.focus();
  });
}

init();
