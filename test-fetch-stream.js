const { Readable } = require('stream');
async function test() {
  const url = 'https://drive.google.com/uc?export=download&id=1G24W1yR_y4uHqP2V1_8P_qM8aFzVqB2g'; // generic ID, will 404 but good for testing API
  const res = await fetch(url);
  console.log(res.status);
}
test().catch(console.error);
