export const handler = (event, context, callback) => {
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
    // This will NOT match sub-pages like /sports/news, /programming/shows, etc.
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

    // Cookie name will be based on the page (e.g., 'sports-origin', 'programming-origin', 'channels-origin')
    const cookieName = `${currentPage}-origin`;

    // Get the split ratio for the current page, default to 0.5 if not configured
    const splitRatio = splitRatios[currentPage] || 0.5;

    // Determine whether the user has visited before based on a cookie value
    if (headers.cookie) {
        for (let i = 0; i < headers.cookie.length; i++) {
            if (headers.cookie[i].value.indexOf(`${cookieName}=A`) >= 0) {
                console.log(`${currentPage} Origin A cookie found, routing to origin A`);
                headers['host'] = [{key: 'host', value: originA}];
                origin.custom.domainName = originA;
                break;
            } else if (headers.cookie[i].value.indexOf(`${cookieName}=B`) >= 0) {
                console.log(`${currentPage} Origin B cookie found, routing to origin B`);
                headers['host'] = [{key: 'host', value: originB}];
                origin.custom.domainName = originB;
                break;
            }
        }
    } else {
        // New visitor so no cookie set, use configured split ratio
        if (Math.random() < splitRatio) {
            headers['host'] = [{key: 'host', value: originA}];
            origin.custom.domainName = originA;
            console.log(`${currentPage} - New visitor randomly selected origin A (${Math.round(splitRatio * 100)}% chance)`);
        } else {
            headers['host'] = [{key: 'host', value: originB}];
            origin.custom.domainName = originB;
            console.log(`${currentPage} - New visitor randomly selected origin B (${Math.round((1 - splitRatio) * 100)}% chance)`);
        }
    }

    callback(null, request);
}; 