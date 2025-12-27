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
    
    // Updated Chart Design
    const ctx = document.getElementById('contentChart');
    new Chart(ctx, { 
        type: 'doughnut', 
        data: { 
            labels: ['Notes','Exams'], 
            datasets: [{ 
                data: [n.size, e.size], 
                backgroundColor: ['#4f46e5', '#ec4899'], 
                borderWidth: 0 
            }] 
        },
        options: { cutout: '70%', plugins: { legend: { display: false } } } 
    });
}

// --- USER MANAGEMENT ---
window.loadUsers = async () => {
    const list = document.getElementById('user-list'); list.innerHTML = `<div class="text-center p-4 text-slate-400">Loading...</div>`;
    const snaps = await getDocs(collection(db,"students")); list.innerHTML = "";
    snaps.forEach(doc => { 
        const u = doc.data();
        list.innerHTML += `
        <div class="p-4 hover:bg-slate-50 transition flex justify-between items-center group">
            <div class="flex items-center gap-3">
                <img src="${u.photo || 'https://cdn-icons-png.flaticon.com/512/149/149071.png'}" class="w-8 h-8 rounded-full border border-slate-200">
                <div>
                    <b class="text-slate-700 text-sm block">${u.name}</b>
                    <span class="text-xs text-slate-400">${u.email} • <span class="bg-blue-100 text-blue-600 px-1 rounded text-[10px]">${u.batch||'All'}</span></span>
                </div>
            </div>
            <div class="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition">
                <button onclick="resetDevice('${doc.id}')" title="Reset Device Lock" class="w-8 h-8 rounded-full bg-orange-50 text-orange-600 hover:bg-orange-100 flex items-center justify-center"><i class="fas fa-mobile-alt"></i></button>
                <button onclick="viewReport('${u.uid}','${u.name}')" class="w-8 h-8 rounded-full bg-indigo-50 text-indigo-600 hover:bg-indigo-100 flex items-center justify-center"><i class="fas fa-chart-line"></i></button>
                ${u.role !== 'admin' ? `<button onclick="delUser('${doc.id}')" class="w-8 h-8 rounded-full bg-red-50 text-red-500 hover:bg-red-100 flex items-center justify-center"><i class="fas fa-trash"></i></button>` : ''}
            </div>
        </div>`; 
    });
};

window.resetDevice = async (id) => {
    if(confirm("Unlock account for a new device?")) {
        await updateDoc(doc(db, "students", id), { deviceId: null });
        alert("Device Reset Successfully"); loadUsers();
    }
};

window.registerStudent = async () => {
    const email = document.getElementById('new-email').value;
    const batch = document.getElementById('new-batch').value;
    if(!email) return;
    await addDoc(collection(db,"students"), { email, batch, role: "student", approved: true, photo: "https://cdn-icons-png.flaticon.com/512/149/149071.png", name: "Student" });
    document.getElementById('new-email').value = "";
    loadUsers();
};

// --- CONTENT MANAGEMENT ---
document.getElementById('upload-btn').addEventListener('click', async () => {
    const file = document.getElementById('note-file').files[0];
    const title = document.getElementById('note-title').value;
    if(!file || !title) return alert("Missing info");
    
    const f = new FormData(); f.append('file', file); f.append('upload_preset', 'lms_upload');
    const r = await fetch('https://api.cloudinary.com/v1_1/dpe74ejhl/upload', {method:'POST', body:f});
    const d = await r.json();
    
    await addDoc(collection(db,"notes"), { title, batch: document.getElementById('note-batch').value, url: d.secure_url, type: d.format==='pdf'?'pdf':'image', createdAt: serverTimestamp() });
    alert("Content Uploaded!"); location.reload();
});

window.pubPDF = async () => {
    const file = document.getElementById('pe-file').files[0];
    if(!file) return alert("No file");
    
    const f = new FormData(); f.append('file', file); f.append('upload_preset', 'lms_upload');
    const r = await fetch('https://api.cloudinary.com/v1_1/dpe74ejhl/upload', {method:'POST', body:f});
    const d = await r.json();
    
    const keys = []; document.querySelectorAll('.pk').forEach(s => keys.push(parseInt(s.value)));
    await addDoc(collection(db,"exams"), { title: document.getElementById('pe-title').value, duration: document.getElementById('pe-dur').value, fileUrl: d.secure_url, answerKey: keys, type: "pdf_exam", createdAt: serverTimestamp() });
    alert("Exam Published!"); location.reload();
};

window.genKeys = () => {
    const c = document.getElementById('pe-count').value;
    const d = document.getElementById('pe-keys'); d.innerHTML = "";
    for(let i=0; i<c; i++) {
        d.innerHTML += `<select class="pk border rounded p-1 text-xs"><option value="0">1-A</option><option value="1">1-B</option><option value="2">1-C</option><option value="3">1-D</option></select>`;
    }
};

// --- SUBMISSIONS & OPS ---
async function loadSubmissions() {
    const list = document.getElementById('submission-list'); list.innerHTML = "";
    const snaps = await getDocs(query(collection(db, "submissions"), orderBy("submittedAt", "desc")));
    snaps.forEach(doc => { 
        const s = doc.data(); 
        list.innerHTML += `
        <div class="p-3 border rounded-xl bg-slate-50 mb-2 flex justify-between items-center text-xs">
            <div class="flex items-center gap-2">
                <div class="w-8 h-8 rounded-full bg-white border flex items-center justify-center font-bold text-slate-500">${s.studentName.charAt(0)}</div>
                <div><span class="font-bold block">${s.studentName}</span><span class="text-slate-400">HW ID: ${doc.id.substr(0,4)}</span></div>
            </div>
            <div class="flex gap-2">
                <a href="${s.fileUrl}" target="_blank" class="bg-blue-100 text-blue-600 px-3 py-1 rounded-lg font-bold hover:bg-blue-200">View</a>
                <button onclick="markGraded('${doc.id}')" class="${s.graded?'bg-green-100 text-green-600':'bg-slate-200 text-slate-500'} px-3 py-1 rounded-lg font-bold">${s.graded?'Done':'Mark'}</button>
            </div>
        </div>`; 
    });
}
window.markGraded = async (id) => { await updateDoc(doc(db,"submissions",id),{graded:true}); loadSubmissions(); };
window.setLive = async () => { await setDoc(doc(db,"settings","live"), { active:true, topic: document.getElementById('live-topic').value, url: document.getElementById('live-url').value }); alert("You are LIVE!"); };
window.toggleMaint = async () => { const s = document.getElementById('maint-toggle').checked; await setDoc(doc(db,"settings","system"), { maintenance: s }, {merge:true}); alert("System Status Updated"); };
window.postHW = async () => { await addDoc(collection(db,"assignments"), { title: document.getElementById('hw-title').value, dueDate: document.getElementById('hw-date').value }); alert("Posted!"); location.reload(); };
window.exportCSV = async () => { const snaps = await getDocs(collection(db,"results")); let csv = "Name,Exam,Score,Total\n"; snaps.forEach(d => { const r=d.data(); csv += `${r.studentName},${r.examTitle},${r.score},${r.total}\n`; }); const blob = new Blob([csv], { type: 'text/csv' }); const a = document.createElement('a'); a.href = window.URL.createObjectURL(blob); a.download = "results.csv"; a.click(); };
window.updateAnnouncement = async () => { await setDoc(doc(db,"settings","announcement"), { text: document.getElementById('announce-text').value }); alert("Announcement Updated"); };
document.getElementById('logout-btn').addEventListener('click', () => signOut(auth).then(()=>location.href="index.html"));
