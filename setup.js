
const fs = require('fs');
const path = require('path');

console.log('🚀 Brill Backend Setup');
console.log('======================');

// Check if .env file exists
const envPath = path.join(__dirname, '.env');
if (!fs.existsSync(envPath)) {
  console.log('⚠️  .env file not found. Please copy .env.example to .env and configure it.');
  
  // Copy .env.example to .env if it exists
  const envExamplePath = path.join(__dirname, '.env.example');
  if (fs.existsSync(envExamplePath)) {
    fs.copyFileSync(envExamplePath, envPath);
    console.log('✅ Created .env file from .env.example template');
    console.log('📝 Please edit .env file with your actual configuration values');
  }
} else {
  console.log('✅ .env file found');
}

// Check package.json dependencies
console.log('\n📦 Checking dependencies...');
try {
  const packageJson = require('./package.json');
  console.log(`✅ Package: ${packageJson.name} v${packageJson.version}`);
  console.log('✅ Dependencies loaded');
} catch (error) {
  console.log('❌ Error reading package.json:', error.message);
}

// Check TypeScript configuration
const tsconfigPath = path.join(__dirname, 'tsconfig.json');
if (fs.existsSync(tsconfigPath)) {
  console.log('✅ TypeScript configuration found');
} else {
  console.log('⚠️  TypeScript configuration not found');
}

console.log('\n🏃‍♂️ Ready to run:');
console.log('   npm install    - Install dependencies');
console.log('   npm run dev    - Start development server');
console.log('   npm run build  - Build for production');
console.log('   npm start      - Start production server');

console.log('\n🌐 Server will run on: http://0.0.0.0:5000');
console.log('📊 Health check: http://0.0.0.0:5000/health');
console.log('🔧 API base: http://0.0.0.0:5000/api');
