import { createTag } from '../../scripts/utils.js';

/*
async function authenticate() {
    let authURL = 'https://multipass.q.sling.com/as/authorization.oauth2';
    const params = {
      redirect_uri: 'https://ms.q.sling.com/sling-api/oauth-helper/alpha/auth-callback',
      client_id: 'aem_agentless_idp_client',
      response_type: 'code',
    };
    Object.keys(params).forEach((param, index) => {
      if (index === 0)
       { authURL = authURL.concat(`?${param}=${params[param]}`); }
     else
      authURL = authURL.concat(`&${param}=${params[param]}`);
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
*/
async function authenticateUser(email, password) {
  const url = 'https://ms.p.sling.com/sling-api/oauth-helper/alpha/authenticate';
  const body = JSON.stringify({
    username: email, // or 'email' if that's what the API expects
    password,
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Add any other required headers here
    },
    body,
    credentials: 'include', // if cookies/session are needed
  });

  if (!response.ok) {
    // Return error message from server if available
    let errorMsg = 'Sign-in failed. Please check your credentials.';
    try {
      const errorData = await response.json();
      if (errorData && errorData.message) errorMsg = errorData.message;
    } catch (e) {
      console.log(errorMsg);
    }
    throw new Error(errorMsg);
  }
  return response.json();
}

export default async function decorate(block) {
  const formContainer = createTag('div', { class: 'signin-form-container' });

  // Add the heading/title
  const heading = createTag('h2', { class: 'signin-title' });
  heading.innerText = 'Sign in to Sling TV';

  const form = createTag('form', { type: 'submit', class: 'signin-frm', novalidate: '' });

  // Email floating label group
  const emailGroup = createTag('div', { class: 'floating-label-group' });
  const userName = createTag('input', {
    class: 'input username',
    type: 'email',
    name: 'email',
    id: 'email',
    placeholder: ' ', // single space to keep input height
    required: '',
    autocomplete: 'email',
  });
  const emailLabel = createTag('label', { for: 'email', class: 'floating-label' });
  emailLabel.innerText = 'Email Address';
  const emailError = createTag('div', { class: 'error-message', style: 'display:none;' });
  emailError.innerText = 'Please enter a valid email address.';
  emailGroup.append(userName, emailLabel, emailError);

  // Password floating label group
  const passwordGroup = createTag('div', { class: 'floating-label-group password-group' });
  const password = createTag('input', {
    class: 'input password',
    type: 'password',
    name: 'password',
    id: 'password',
    placeholder: ' ',
    autocomplete: 'current-password',
  });
  const passwordLabel = createTag('label', { for: 'password', class: 'floating-label' });
  passwordLabel.innerText = 'Password';
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
  passwordGroup.append(password, passwordLabel, toggle, passwordError);

  // Sign In button
  const signinBtn = createTag('button', {
    type: 'submit', id: 'signin', value: 'Sign In', class: 'primary',
  });
  const btnText = createTag('span', { class: 'btn-text' });
  btnText.innerText = 'Sign In';
  signinBtn.append(btnText);

  // Assemble the form (no extra elements by default)
  form.append(emailGroup, passwordGroup, signinBtn);

  // If block has 'google' class, add extra links, divider, and Google sign-in button
  if (block.classList.contains('google')) {
    // Links
    const forgot = createTag('div', { class: 'signin-links' });
    forgot.innerHTML = 'Forgot your <a href="www.sling.com/sign-in/forgot-password" class="forgot-link">password</a> or <a href="www.sling.com/sign-in/forgot-username" class="forgot-link">username/email</a>?<br>Not a Sling user? <a href="/" class="signup-link">Check us out!</a>';
    // Divider
    const divider = createTag('div', { class: 'signin-divider' });
    divider.innerHTML = '<span>OR</span>';
    // Google sign-in button
    const googleBtn = createTag('button', { type: 'button', class: 'google-signin-btn' });
    googleBtn.innerHTML = '<img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" class="google-icon"> Sign in with Google';
    form.append(forgot, divider, googleBtn);
  }

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

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    let valid = true;
    if (!validateEmail()) valid = false;
    if (!validatePassword()) valid = false;
    if (!valid) return;

    // Disable button to prevent double submit
    signinBtn.disabled = true;
    btnText.innerText = 'Signing in...';

    try {
      const data = await authenticateUser(userName.value, password.value);
      // Handle successful login (redirect, show message, etc.)
      window.location.href = data.redirect_uri || '/'; // or whatever the API returns
    } catch (err) {
      // Show error message
      password.classList.add('error');
      passwordError.style.display = '';
      passwordError.innerText = err.message;
    } finally {
      signinBtn.disabled = false;
      btnText.innerText = 'Sign In';
    }
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
}