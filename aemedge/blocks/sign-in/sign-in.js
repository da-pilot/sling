import { createTag } from '../../scripts/utils.js';

async function authenticate() {
  let authURL = 'https://multipass.q.sling.com/as/authorization.oauth2';
  const params = {
    redirect_uri: 'https://ms.q.sling.com/sling-api/oauth-helper/alpha/auth-callback',
    client_id: 'aem_agentless_idp_client',
    response_type: 'code',
  };

  Object.keys(params).forEach((param, index) => {
    if (index === 0) { authURL = authURL.concat(`?${param}=${params[param]}`); } else authURL = authURL.concat(`&${param}=${params[param]}`);
  });

  const config = {
    method: 'GET',
  };

  const response = await fetch(authURL, config);
  const data = await response.json();
  console.log(data);
  if (response.ok && data) {
    if (data.redirect_uri.includes('watch')) {
      window.location = data.redirect_uri;
    }
    console.log(data);
  }
}

export default async function decorate(block) {
  const formContainer = createTag('div', { class: 'signin-form-container' });

  // Add the heading/title
  const heading = createTag('h2', { class: 'signin-title' });
  heading.innerText = 'Sign in to Sling TV';

  const form = createTag('form', { type: 'submit', class: 'signin-frm', novalidate: '' });

  // Email input group (label inside the input box)
  const emailGroup = createTag('div', { class: 'input-group' });
  const emailLabel = createTag('span', { class: 'input-label-inside' });
  emailLabel.innerText = 'Email Address';
  const userName = createTag('input', {
    class: 'input username',
    type: 'email',
    name: 'email',
    id: 'email',
    placeholder: 'username@domain.com',
    required: '',
    autocomplete: 'email',
  });
  const emailError = createTag('div', { class: 'error-message', style: 'display:none;' });
  emailError.innerText = 'Please enter a valid email address.';
  emailGroup.append(emailLabel, userName, emailError);

  // Password input group (label inside the input box)
  const passwordGroup = createTag('div', { class: 'input-group password-group' });
  const passwordLabel = createTag('span', { class: 'input-label-inside' });
  passwordLabel.innerText = 'Password';
  const password = createTag('input', {
    class: 'input password',
    type: 'password',
    name: 'password',
    id: 'password',
    placeholder: 'Password',
    autocomplete: 'current-password',
  });
  // Show/hide toggle icon
  const toggle = createTag('span', {
    class: 'toggle-password',
    tabindex: 0,
    role: 'button',
    'aria-label': 'Show password',
  });
  toggle.innerHTML = '<svg width="24" height="24" fill="none" stroke="#888" stroke-width="2" viewBox="0 0 24 24"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/><line x1="3" y1="3" x2="21" y2="21" stroke="#888" stroke-width="2"/></svg>';
  toggle.addEventListener('click', () => {
    password.type = password.type === 'password' ? 'text' : 'password';
    toggle.setAttribute('aria-label', password.type === 'password' ? 'Show password' : 'Hide password');
  });
  const passwordError = createTag('div', { class: 'error-message', style: 'display:none;' });
  passwordError.innerText = 'Password is required.';
  passwordGroup.append(passwordLabel, password, toggle, passwordError);

  // Sign In button
  const signinBtn = createTag('button', {
    type: 'submit', id: 'signin', value: 'Sign In', class: 'primary',
  });
  const btnText = createTag('span', { class: 'btn-text' });
  btnText.innerText = 'Sign In';
  signinBtn.append(btnText);

  // Assemble the form (no extra elements)
  form.append(emailGroup, passwordGroup, signinBtn);
  formContainer.append(heading, form);
  block.append(formContainer);

  // Validation logic
  function validateEmail() {
    if (!userName.value || !/^[^@]+@[^@]+\.[^@]+$/.test(userName.value)) {
      userName.classList.add('error');
      emailError.style.display = '';
      return false;
    }
    userName.classList.remove('error');
    emailError.style.display = 'none';
    return true;
  }
  function validatePassword() {
    if (!password.value) {
      password.classList.add('error');
      passwordError.style.display = '';
      return false;
    }
    password.classList.remove('error');
    passwordError.style.display = 'none';
    return true;
  }

  form.addEventListener('submit', (e) => {
    let valid = true;
    if (!validateEmail()) valid = false;
    if (!validatePassword()) valid = false;
    if (!valid) e.preventDefault();
  });

  // Validate on blur (focus out)
  userName.addEventListener('blur', validateEmail);
  password.addEventListener('blur', validatePassword);

  // Remove error on input
  userName.addEventListener('input', () => {
    userName.classList.remove('error');
    emailError.style.display = 'none';
  });
  password.addEventListener('input', () => {
    password.classList.remove('error');
    passwordError.style.display = 'none';
  });

  await authenticate();
}