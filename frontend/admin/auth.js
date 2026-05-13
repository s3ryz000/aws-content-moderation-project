/* Auth config — fill in after terraform apply (Task 7) */
var COGNITO_DOMAIN = 'https://cm-admin-737710549268.auth.ap-southeast-2.amazoncognito.com';
var CLIENT_ID      = 'r2c11ei4tnj19uo5cpe0mavkg';
var REDIRECT_URI   = 'http://localhost:8080/frontend/admin/callback.html';

function getToken() {
    var token     = localStorage.getItem('idToken');
    var expiresAt = parseInt(localStorage.getItem('expiresAt') || '0', 10);
    if (!token || Date.now() >= expiresAt) { return null; }
    return token;
}

function getAuthHeader() {
    var token = getToken();
    if (!token) { throw new Error('No valid token'); }
    return { 'Authorization': 'Bearer ' + token };
}

function redirectToLogin() {
    var verifier = _generateVerifier();
    var state    = _generateVerifier();
    sessionStorage.setItem('pkce_verifier', verifier);
    sessionStorage.setItem('pkce_state',    state);
    _generateChallenge(verifier).then(function(challenge) {
        window.location.href = _buildAuthorizeUrl(challenge, state);
    });
}

function _buildAuthorizeUrl(codeChallenge, state) {
    return COGNITO_DOMAIN + '/oauth2/authorize'
        + '?response_type=code'
        + '&client_id='            + encodeURIComponent(CLIENT_ID)
        + '&redirect_uri='         + encodeURIComponent(REDIRECT_URI)
        + '&scope=openid+email+profile'
        + '&code_challenge_method=S256'
        + '&code_challenge='       + encodeURIComponent(codeChallenge)
        + '&state='                + encodeURIComponent(state);
}

function logout() {
    localStorage.removeItem('idToken');
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('expiresAt');
    window.location.href = COGNITO_DOMAIN + '/logout'
        + '?client_id='  + encodeURIComponent(CLIENT_ID)
        + '&logout_uri=' + encodeURIComponent('http://localhost:8080/frontend/');
}

function _generateVerifier() {
    var arr = new Uint8Array(32);
    crypto.getRandomValues(arr);
    return _base64urlEncode(arr);
}

function _generateChallenge(verifier) {
    var enc = new TextEncoder().encode(verifier);
    return crypto.subtle.digest('SHA-256', enc).then(function(hash) {
        return _base64urlEncode(new Uint8Array(hash));
    });
}

function _base64urlEncode(arr) {
    return btoa(String.fromCharCode.apply(null, arr))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}
