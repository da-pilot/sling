'use strict';

exports.handler = (event, context, callback) => {
    const response = event.Records[0].cf.response;
    const request = event.Records[0].cf.request;
    const headers = response.headers;
    const uri = request.uri;

    // Define the pages that need traffic splitting
    const pagesToSplit = ['/sports', '/programming', '/channels'];
    
    // Check if this is one of our target pages
    const isTargetPage = pagesToSplit.includes(uri);
    
    if (!isTargetPage) {
        callback(null, response);
        return;
    }

    // Determine which page this request is for
    let currentPage = '';
    for (const page of pagesToSplit) {
        if (uri === page) {
            currentPage = page.replace('/', '');
            break;
        }
    }

    // Check if user already has a cookie for this page
    const cookieName = `${currentPage}-origin`;
    let hasCookie = false;
    
    if (request.headers.cookie) {
        for (let i = 0; i < request.headers.cookie.length; i++) {
            if (request.headers.cookie[i].value.indexOf(`${cookieName}=`) >= 0) {
                hasCookie = true;
                break;
            }
        }
    }

    // If no cookie exists, set one based on the origin that was used
    if (!hasCookie) {
        // Determine which origin was used based on the host header
        const hostHeader = request.headers.host[0].value;
        let originLabel = 'A'; // default
        
        // You'll need to adjust this logic based on your actual origin domains
        if (hostHeader.includes('origin-b') || hostHeader.includes('second')) {
            originLabel = 'B';
        }
        
        // Set the cookie
        const cookieValue = `${cookieName}=${originLabel}; Path=/; Max-Age=86400; HttpOnly; Secure; SameSite=Lax`;
        
        if (!headers['set-cookie']) {
            headers['set-cookie'] = [];
        }
        headers['set-cookie'].push({
            key: 'Set-Cookie',
            value: cookieValue
        });
        
        console.log(`Setting cookie for ${currentPage}: ${cookieValue}`);
    }

    callback(null, response);
}; 