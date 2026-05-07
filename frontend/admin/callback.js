(function() {
    var params   = new URLSearchParams(window.location.search);
    var code     = params.get('code');
    var state    = params.get('state');
    var verifier = sessionStorage.getItem('pkce_verifier');

    function showError(msg) {
        var el = document.getElementById('status');
        el.textContent = 'Sign-in failed: ' + msg + '. Please close this tab and try again.';
        el.style.color = '#dc2626';
    }

    if (!code || !state || state !== sessionStorage.getItem('pkce_state')) {
        showError('invalid state parameter');
        return;
    }

    sessionStorage.removeItem('pkce_state');
    sessionStorage.removeItem('pkce_verifier');

    fetch(COGNITO_DOMAIN + '/oauth2/token', {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=authorization_code'
            + '&client_id='     + encodeURIComponent(CLIENT_ID)
            + '&redirect_uri='  + encodeURIComponent(REDIRECT_URI)
            + '&code='          + encodeURIComponent(code)
            + '&code_verifier=' + encodeURIComponent(verifier)
    })
    .then(function(resp) {
        if (!resp.ok) {
            return resp.text().then(function(t) { throw new Error(t); });
        }
        return resp.json();
    })
    .then(function(data) {
        localStorage.setItem('idToken',      data.id_token);
        localStorage.setItem('accessToken',  data.access_token);
        localStorage.setItem('refreshToken', data.refresh_token);
        localStorage.setItem('expiresAt',    String(Date.now() + data.expires_in * 1000));
        window.location.replace('/frontend/admin/index.html');
    })
    .catch(function(err) {
        showError(err.message);
    });
})();
