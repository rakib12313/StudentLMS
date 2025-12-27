import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { doc, getDoc, collection, getDocs, setDoc, addDoc, deleteDoc, updateDoc, serverTimestamp, query, orderBy } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// Security Check
onAuthStateChanged(auth, async (user) => {
    if(!user) return location.href="index.html";
    const d = await getDoc(doc(db, "students", user.uid));
    if(!d.exists() || d.data().role !== "admin") return location.href="index.html";
    loadDashboard();
});

async function loadDashboard() {
    loadUsers();
    const u = await getDocs(collection(db, "students"));
    const n = await getDocs(collection(db, "notes"));
    document.getElementById('stat-users').innerText = u.size;
    document.getElementById('stat-notes').innerText = n.size;
}

// User List
window.loadUsers = async () => {
    const list = document.getElementById('user-list');
    list.innerHTML = '<p class="p-4 text-xs">Loading...</p>';
    const q = query(collection(db, "students"), orderBy("createdAt", "desc"));
    const snaps = await getDocs(q);
    let html = '';
    snaps.forEach(d => {
        const u = d.data();
        html += `
        <div class="p-3 flex justify-between items-center hover:bg-slate-50">
            <div class="flex items-center gap-3">
                <div class="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center font-bold text-xs text-indigo-700">${u.name?u.name[0]:'U'}</div>
                <div>
                    <span class="block text-xs font-bold">${u.name}</span>
                    <span class="text-[10px] text-slate-400">${u.email}</span>
                </div>
            </div>
            <div class="flex gap-2">
                <button onclick="resetDevice('${d.id}')" class="text-orange-500 hover:bg-orange-50 p-2 rounded"><i class="fas fa-mobile-alt"></i></button>
                <button onclick="deleteUser('${d.id}')" class="text-red-500 hover:bg-red-50 p-2 rounded"><i class="fas fa-trash"></i></button>
            </div>
        </div>`;
    });
    list.innerHTML = html;
};

// Actions
window.resetDevice = async (id) => { if(confirm("Reset Device Lock?")) { await updateDoc(doc(db,"students",id),{deviceId:null}); loadUsers(); }};
window.deleteUser = async (id) => { if(confirm("Delete User?")) { await deleteDoc(doc(db,"students",id)); loadUsers(); }};

document.getElementById('upload-btn').addEventListener('click', async () => {
    const file = document.getElementById('note-file').files[0];
    const title = document.getElementById('note-title').value;
    if(!file || !title) return alert("Missing Info");
    const f = new FormData(); f.append('file', file); f.append('upload_preset', 'lms_upload');
    const r = await fetch('https://api.cloudinary.com/v1_1/dpe74ejhl/upload', {method:'POST', body:f});
    const d = await r.json();
    await addDoc(collection(db, "notes"), {
        title, batch: document.getElementById('note-batch').value,
        url: d.secure_url, type: d.format==='pdf'?'pdf':'image', createdAt: serverTimestamp()
    });
    alert("Uploaded!"); location.reload();
});

window.toggleLive = async () => {
    const active = document.getElementById('live-toggle').checked;
    await setDoc(doc(db,"settings","live"), { active, url: document.getElementById('live-url').value });
    if(active) alert("Live Session Started!");
};

window.updateAnnouncement = async () => {
    await setDoc(doc(db,"settings","announcement"), { text: document.getElementById('announce-text').value });
    alert("Banner Updated");
};

// Exam Logic
window.genKeys = () => {
    const c = document.getElementById('pe-count').value;
    let h = '';
    for(let i=0; i<c; i++) h += `<select class="pk border rounded p-1 text-[10px]"><option value="0">A</option><option value="1">B</option><option value="2">C</option><option value="3">D</option></select>`;
    document.getElementById('pe-keys').innerHTML = h;
};
window.pubPDF = async () => {
    const file = document.getElementById('pe-file').files[0];
    if(!file) return alert("Select PDF");
    const f = new FormData(); f.append('file', file); f.append('upload_preset', 'lms_upload');
    const r = await fetch('https://api.cloudinary.com/v1_1/dpe74ejhl/upload', {method:'POST', body:f});
    const d = await r.json();
    const keys = []; document.querySelectorAll('.pk').forEach(s => keys.push(parseInt(s.value)));
    await addDoc(collection(db,"exams"), {
        title: document.getElementById('pe-title').value,
        duration: document.getElementById('pe-dur').value,
        batch: document.getElementById('pe-batch').value,
        fileUrl: d.secure_url, answerKey: keys, type: "pdf_exam", createdAt: serverTimestamp()
    });
    alert("Exam Published"); location.reload();
};