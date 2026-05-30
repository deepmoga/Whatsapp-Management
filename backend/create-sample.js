// Run: node create-sample.js
// Eh script sample Excel file banayega

const XLSX = require('xlsx');

const contacts = [
  { phone_number: '9876543210', name: 'Gurpreet Singh' },
  { phone_number: '+919876543211', name: 'Harpreet Kaur' },
  { phone_number: '919876543212', name: 'Manpreet Singh' },
  { phone_number: '8765432109', name: 'Sukhpreet Kaur' },
  { phone_number: '+918765432108', name: 'Jaspreet Singh' },
];

const wb = XLSX.utils.book_new();
const ws = XLSX.utils.json_to_sheet(contacts);
ws['!cols'] = [{ width: 20 }, { width: 25 }];
XLSX.utils.book_append_sheet(wb, ws, 'Contacts');
XLSX.writeFile(wb, 'sample_contacts.xlsx');
console.log('✅ sample_contacts.xlsx ban gaya!');
