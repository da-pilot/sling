// cf-lambda/aem-eds-traffic-splitter.js
export const handler = (event, context, callback) => {
    const request = event.Records[0].cf.request;
    const origin = request.origin;
    const uri = request.uri;
    // Define the pages that need traffic splitting (ROOT PATHS ONLY)
    const pagesToSplit = ['/sports', '/programming', '/channels'];
    // Configure split ratios for each page (percentage going to origin A)
    const splitRatios = {
        'sports': 0.5,      // 50% to origin A, 50% to origin B
        'programming': 0.5, // 50% to origin A, 50% to origin B
        'channels': 0.5     // 50% to origin A, 50% to origin B
    };
    // Check if the current request is for one of our target ROOT pages ONLY
    if (!pagesToSplit.includes(uri)) {
        callback(null, request);
        return;
    }
    // Determine which page this request is for
    const currentPage = uri.replace('/', ''); // Remove leading slash
    // Setup the two different origins
    const originA = "main--sling--da-pilot.aem.live";
    const originB = "origin-slingtv-b75-prod.adobecqms.net";
    // Get the split ratio for the current page, default to 0.5 if not configured
    const splitRatio = splitRatios[currentPage] || 0.5;
    // Randomly assign the origin for every request (no sticky session)
    if (Math.random() < splitRatio) {
        request.headers['host'] = [{key: 'host', value: originA}];
        origin.custom.domainName = originA;
        console.log(`${currentPage} - Randomly selected origin A (${Math.round(splitRatio * 100)}% chance)`);
    } else {
        request.headers['host'] = [{key: 'host', value: originB}];
        origin.custom.domainName = originB;
        console.log(`${currentPage} - Randomly selected origin B (${Math.round((1 - splitRatio) * 100)}% chance)`);
    }
    callback(null, request);
};