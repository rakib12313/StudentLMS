import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { doc, getDoc, collection, getDocs, setDoc, addDoc, deleteDoc, query, orderBy, serverTimestamp, where, updateDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

onAuthStateChanged(auth, async (user) => {
    if(!user) location.href = "index.html";
    const d = await getDoc(doc(db,"students",user.uid));
    if(!d.exists() || d.data().role !== "admin") location.href = "index.html";
    loadStats(); loadUsers(); loadSubmissions();
});

async function loadStats() {
    const u = await getDocs(collection(db,"students"));
    const n = await getDocs(collection(db,"notes"));
    const e = await getDocs(collection(db,"exams"));
    document.getElementById('stat-users').innerText = u.size;
    
    const ctx = document.getElementById('contentChart');
    new Chart(ctx, { type: 'doughnut', data: { labels: ['Notes','Exams'], datasets: [{ data: [n.size, e.size], backgroundColor: ['#3b82f6','#ec4899'] }] } });
}

window.loadUsers = async () => {
    const list = document.getElementById('user-list'); list.innerHTML = "";
    const snaps = await getDocs(collection(db,"students"));
    snaps.forEach(doc => { 
        const u=doc.data(); 
        list.innerHTML += `
        <div class="p-2 border-b flex justify-between text-xs">
            <div><b>${u.name}</b><br>${u.email} <span class="text-gray-400">(${u.batch||'All'})</span></div>
            <div class="flex gap-2">
                <button onclick="viewReport('${u.uid}','${u.name}')" class="text-indigo-500"><i class="fas fa-chart-bar"></i></button>
                <button onclick="delUser('${doc.id}')" class="text-red-500"><i class="fas fa-trash"></i></button>
            </div>
        </div>`; 
    });
};

window.viewReport = async (uid, name) => {
    document.getElementById('report-modal').classList.remove('hidden');
    document.getElementById('rep-name').innerText = name;
    const c = document.getElementById('rep-content'); c.innerHTML = "Loading...";
    const snaps = await getDocs(query(collection(db,"results"), where("studentId","==",uid), orderBy("submittedAt","desc")));
    c.innerHTML = snaps.empty ? "No exams." : "";
    snaps.forEach(doc => { const r=doc.data(); c.innerHTML += `<div class="p-2 border rounded flex justify-between text-xs"><span>${r.examTitle}</span><span class="font-bold ${r.score/r.total>=0.4?'text-green-600':'text-red-600'}">${r.score}/${r.total}</span></div>`; });
};

window.registerStudent = async () => {
    const email = document.getElementById('new-email').value;
    const batch = document.getElementById('new-batch').value;
    await addDoc(collection(db,"students"), { email, batch, role: "student", approved: true, photo: "https://cdn-icons-png.flaticon.com/512/149/149071.png" });
    alert("Added"); loadUsers();
};
window.delUser = async (id) => { if(confirm("Delete?")) { await deleteDoc(doc(db,"students",id)); loadUsers(); } };

// --- UPLOADS ---
document.getElementById('upload-btn').addEventListener('click', async () => {
    const file = document.getElementById('note-file').files[0];
    const title = document.getElementById('note-title').value;
    const batch = document.getElementById('note-batch').value;
    
    const f = new FormData(); f.append('file', file); f.append('upload_preset', 'lms_upload');
    const r = await fetch('https://api.cloudinary.com/v1_1/dpe74ejhl/upload', {method:'POST', body:f});
    const d = await r.json();
    
    await addDoc(collection(db,"notes"), { title, batch, url: d.secure_url, type: d.format==='pdf'?'pdf':'image', createdAt: serverTimestamp() });
    alert("Uploaded");
});

window.postHW = async () => {
    await addDoc(collection(db,"assignments"), { title: document.getElementById('hw-title').value, dueDate: document.getElementById('hw-date').value, createdAt: serverTimestamp() });
    await addDoc(collection(db,"notifications"), { title:"New Homework", message:document.getElementById('hw-title').value, createdAt: serverTimestamp() });
    alert("HW Posted");
};

// --- SUBMISSIONS REVIEW ---
async function loadSubmissions() {
    const list = document.getElementById('submission-list'); list.innerHTML = "Loading...";
    const snaps = await getDocs(query(collection(db, "submissions"), orderBy("submittedAt", "desc")));
    list.innerHTML = "";
    if(snaps.empty) list.innerHTML = "<p class='text-xs'>No pending work.</p>";
    snaps.forEach(doc => {
        const s = doc.data();
        list.innerHTML += `<div class="p-2 border rounded bg-slate-50 flex justify-between items-center text-xs mb-1"><div><p class="font-bold text-slate-700">${s.studentName}</p><a href="${s.fileUrl}" target="_blank" class="text-blue-500 underline">View File</a></div>${s.graded ? '<span class="text-green-600 font-bold">Graded</span>' : `<button onclick="markGraded('${doc.id}')" class="bg-indigo-600 text-white px-2 py-1 rounded">Mark Done</button>`}</div>`;
    });
}
window.markGraded = async (id) => { await updateDoc(doc(db,"submissions",id),{graded:true}); loadSubmissions(); };

// --- PDF EXAM ---
window.genKeys = () => {
    const n = document.getElementById('pe-count').value;
    const c = document.getElementById('pe-keys'); c.innerHTML = "";
    for(let i=0; i<n; i++) c.innerHTML += `<select class="pk border text-xs"><option value="0">A</option><option value="1">B</option><option value="2">C</option><option value="3">D</option></select>`;
};
window.pubPDF = async () => {
    const file = document.getElementById('pe-file').files[0];
    const f = new FormData(); f.append('file', file); f.append('upload_preset', 'lms_upload');
    const r = await fetch('https://api.cloudinary.com/v1_1/dpe74ejhl/upload', {method:'POST', body:f});
    const d = await r.json();
    const keys = []; document.querySelectorAll('.pk').forEach(s => keys.push(parseInt(s.value)));
    await addDoc(collection(db,"exams"), { title: document.getElementById('pe-title').value, duration: document.getElementById('pe-dur').value, fileUrl: d.secure_url, answerKey: keys, type: "pdf_exam", createdAt: serverTimestamp() });
    alert("PDF Exam Published");
};

// --- MISC ADMIN ---
window.setLive = async () => { await setDoc(doc(db,"settings","live"), { active:true, topic: document.getElementById('live-topic').value, url: document.getElementById('live-url').value }); alert("Live!"); };
window.toggleMaint = async () => { const s = document.getElementById('maint-toggle').checked; await setDoc(doc(db,"settings","system"), { maintenance: s }, {merge:true}); alert("Status Updated"); };
window.exportCSV = async () => { const snaps = await getDocs(collection(db,"results")); let csv = "Student,Exam,Score,Total\n"; snaps.forEach(d => { const r=d.data(); csv += `${r.studentName},${r.examTitle},${r.score},${r.total}\n`; }); const blob = new Blob([csv], { type: 'text/csv' }); const a = document.createElement('a'); a.href = window.URL.createObjectURL(blob); a.download = "results.csv"; a.click(); };
window.updateAnnouncement = async () => { await setDoc(doc(db,"settings","announcement"), { text: document.getElementById('announce-text').value }); alert("Updated"); };
window.addVideo = async () => { await addDoc(collection(db,"videos"), { title: document.getElementById('vid-title').value, url: document.getElementById('vid-url').value, createdAt: serverTimestamp() }); alert("Video Added"); };
window.addCard = async () => { await addDoc(collection(db,"flashcards"), { front: document.getElementById('card-f').value, back: document.getElementById('card-b').value, createdAt: serverTimestamp() }); alert("Card Added"); };
document.getElementById('logout-btn').addEventListener('click', () => signOut(auth).then(()=>location.href="index.html"));