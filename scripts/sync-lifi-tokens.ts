// Improved error handling and logging
if (!response.ok) {
    console.error(`Error ${response.status}: ${response.statusText} - ${await response.text()}`);
    throw new Error(`Failed to sync Lifi tokens: ${response.statusText}`);
}
// Additional logging for debug purposes
console.log(`Sync Lifi tokens response: ${await response.json()}`);
