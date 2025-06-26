'use strict';

exports.handler = (event, context, callback) => {
    const request = event.Records[0].cf.request;
    const headers = request.headers;
    const origin = request.origin;
    const uri = request.uri;

    // Define the pages that need traffic splitting (ROOT PATHS ONLY)
    const pagesToSplit = ['/sports', '/programming', '/channels'];
    
    // Configure split ratios for each page (percentage going to origin A)
    // All pages set to 50/50 split
    const splitRatios = {
        'sports': 0.5,      // 50% to origin A, 50% to origin B
        'programming': 0.5, // 50% to origin A, 50% to origin B
        'channels': 0.5     // 50% to origin A, 50% to origin B
    };
    
    // Check if the current request is for one of our target ROOT pages ONLY
    const isTargetPage = pagesToSplit.includes(uri);

    if (!isTargetPage) {
        callback(null, request);
        return;
    }

    // Determine which page this request is for
    let currentPage = '';
    for (const page of pagesToSplit) {
        if (uri === page) {
            currentPage = page.replace('/', ''); // Remove leading slash
            break;
        }
    }

    // Setup the two different origins - REPLACE WITH YOUR ACTUAL ORIGIN DOMAINS
    const originA = "your-first-origin-domain.com";
    const originB = "your-second-origin-domain.com";

    // Cookie name will be based on the page
    const cookieName = `${currentPage}-origin`;
    let selectedOrigin = '';
    let originLabel = '';

    // Determine whether the user has visited before based on a cookie value
    if (headers.cookie) {
        for (let i = 0; i < headers.cookie.length; i++) {
            if (headers.cookie[i].value.indexOf(`${cookieName}=A`) >= 0) {
                console.log(`${currentPage} Origin A cookie found, routing to origin A`);
                selectedOrigin = originA;
                originLabel = 'A';
                break;
            } else if (headers.cookie[i].value.indexOf(`${cookieName}=B`) >= 0) {
                console.log(`${currentPage} Origin B cookie found, routing to origin B`);
                selectedOrigin = originB;
                originLabel = 'B';
                break;
            }
        }
    }

    // If no cookie found, assign a random origin and set a cookie
    if (!selectedOrigin) {
        const splitRatio = splitRatios[currentPage] || 0.5;
        
        if (Math.random() < splitRatio) {
            selectedOrigin = originA;
            originLabel = 'A';
            console.log(`${currentPage} - New visitor randomly selected origin A (${Math.round(splitRatio * 100)}% chance)`);
        } else {
            selectedOrigin = originB;
            originLabel = 'B';
            console.log(`${currentPage} - New visitor randomly selected origin B (${Math.round((1 - splitRatio) * 100)}% chance)`);
        }

        // Set the cookie for future visits
        const cookieValue = `${cookieName}=${originLabel}; Path=/; Max-Age=86400; HttpOnly; Secure; SameSite=Lax`;
        
        if (!headers['set-cookie']) {
            headers['set-cookie'] = [];
        }
        headers['set-cookie'].push({
            key: 'Set-Cookie',
            value: cookieValue
        });
        
        console.log(`Setting cookie: ${cookieValue}`);
    }

    // Update the request to route to the selected origin
    headers['host'] = [{key: 'host', value: selectedOrigin}];
    origin.custom.domainName = selectedOrigin;

    callback(null, request);
}; 