# Cloudflare AI Integration Setup Guide

## Step 1: Enable Cloudflare AI

1. **Login to Cloudflare Dashboard**
   - Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
   - Select your account

2. **Enable AI Service**
   - Navigate to **AI** in the left sidebar
   - Click **Get started** or **Enable AI**
   - Follow the setup wizard

3. **Get Your API Token**
   - In the AI section, go to **API Tokens**
   - Click **Create API Token**
   - Give it a name like "Media Library AI"
   - Select the AI scope
   - Copy the generated token

4. **Get Your Account ID**
   - In the Cloudflare Dashboard, go to **Account Home**
   - Your Account ID is displayed in the right sidebar
   - Copy this ID

## Step 2: Configure the Media Library

1. **Update Configuration File**
   - Open `tools/media-library/config/ai-config.js`
   - Replace the placeholder values:

```javascript
export const CLOUDFLARE_AI_CONFIG = {
  API_TOKEN: 'your-actual-api-token-here',
  ACCOUNT_ID: 'your-actual-account-id-here',
  MODEL: '@cf/microsoft/git-base-coco',
  // ... other settings remain the same
};
```

## Step 3: Test the Integration

1. **Open the Media Library**
2. **Find an image with missing alt text**
3. **Click the info button** on the image
4. **Look for the "Generate AI Alt Text" button** in the modal
5. **Click the button** to test the AI generation

## API Models Available

### Recommended Models:
- **`@cf/microsoft/git-base-coco`** - Best for image captioning
- **`@cf/salesforce/blip-2.7b`** - Good for detailed descriptions
- **`@cf/meta/llama-2-7b-chat-int8`** - General purpose

### To change models:
Edit the `MODEL` field in `ai-config.js`:

```javascript
MODEL: '@cf/salesforce/blip-2.7b', // Change to your preferred model
```

## Cost Information

### Free Tier:
- **1,000 requests per day**
- Perfect for testing and small projects

### Paid Tier:
- **$0.50 per 1,000 requests**
- Very cost-effective for production use

## Troubleshooting

### Common Issues:

1. **"Cloudflare AI is not properly configured"**
   - Check that your API token and account ID are correct
   - Ensure AI is enabled in your Cloudflare account

2. **"API request failed"**
   - Verify your API token has the correct permissions
   - Check that the image URL is publicly accessible

3. **"No alt text generated"**
   - The AI model might not have processed the image correctly
   - Try a different model or check the image format

### Debug Mode:
Add this to your browser console to see detailed logs:

```javascript
// Enable debug logging
localStorage.setItem('ai-debug', 'true');
```

## Security Notes

- **Never commit API tokens to version control**
- **Use environment variables in production**
- **Consider using a backend proxy for additional security**

## Performance Tips

1. **Image Optimization**: Ensure images are properly sized (max 10MB)
2. **Caching**: Consider caching generated alt text to avoid repeated API calls
3. **Rate Limiting**: Implement client-side rate limiting for heavy usage

## Support

If you encounter issues:
1. Check the browser console for error messages
2. Verify your Cloudflare AI configuration
3. Test with a simple, publicly accessible image URL
4. Contact Cloudflare support if API issues persist 