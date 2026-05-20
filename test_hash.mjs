import bcrypt from "bcryptjs";

const hash = "$2b$10$IFRg/Kx1mZtpUvHL4QPuD.Icm9uSymC3Z4rcbhRiU9L7bC/qdaO/i";

// Test with the exact string "ahmed\doza" (10 chars, backslash)
const pw = "ahmed\u005cdoza";
console.log("pw:", JSON.stringify(pw), "len:", pw.length);
console.log("match:", bcrypt.compareSync(pw, hash));

// Test what PowerShell sends
const jsonBody = '{"staffId":"DOZACOFFEE","pin":"ahmed\\\\doza"}';
const parsed = JSON.parse(jsonBody);
console.log("from JSON:", JSON.stringify(parsed.pin), "len:", parsed.pin.length);
console.log("match JSON:", bcrypt.compareSync(parsed.pin, hash));

// Generate a fresh hash
const freshHash = bcrypt.hashSync(pw, 10);
console.log("fresh hash:", freshHash);
console.log("fresh match:", bcrypt.compareSync(pw, freshHash));
