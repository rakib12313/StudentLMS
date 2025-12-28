import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { doc, getDoc, collection, getDocs, setDoc, addDoc, deleteDoc, updateDoc, serverTimestamp, query, orderBy } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

let bulkData = [];

onAuthStateChanged(auth, async (user) => {
    if(!user) return location.href="index.html";
    const d = await getDoc(doc(db, "students", user.uid));
    if(!d.exists() || d.data().role !== "admin") return location.href="index.html";
    loadDashboard();
});

async function loadDashboard() {
    loadExams();
    const u = await getDocs(collection(db, "students"));
    const e = await getDocs(collection(db, "exams"));
    document.getElementById('stat-users').innerText = u.size;
    document.getElementById('stat-exams').innerText = e.size;
}

// Question Builder UI
window.addQuestion = () => {
    const id = Date.now();
    const h = `
    <div class="p-5 bg-white border border-slate-200 rounded-xl relative q-item shadow-sm" id="q-${id}">
        <button onclick="document.getElementById('q-${id}').remove()" class="absolute top-3 right-3 text-slate-300 hover:text-red-500"><i class="fas fa-trash"></i></button>
        <div class="space-y-3">
            <div>
                <label class="text-[10px] font-bold text-slate-400 uppercase">Question (Supports MathJax)</label>
                <textarea class="w-full p-2 border rounded text-sm font-bold q-txt bg-slate-50" rows="2" placeholder="e.g. Solve \\( x^2 + 2x + 1 = 0 \\)"></textarea>
            </div>
            <div>
                <label class="text-[10px] font-bold text-slate-400 uppercase">Image URL (Optional)</label>
                <input class="w-full p-2 border rounded text-xs q-img" placeholder="https://...">
            </div>
            <div class="grid grid-cols-2 gap-3">
                ${[0,1,2,3].map(i => `<div class="flex items-center gap-2"><span class="text-xs font-bold text-slate-400">${String.fromCharCode(65+i)}</span><input class="w-full border rounded p-2 text-xs q-opt-${i}"></div>`).join('')}
            </div>
            <div class="flex gap-4 pt-2 border-t">
                <div class="w-1/3">
                    <label class="text-[10px] font-bold text-indigo-600 uppercase">Correct Answer</label>
                    <select class="w-full p-2 border rounded text-xs font-bold q-ans bg-indigo-50"><option value="0">A</option><option value="1">B</option><option value="2">C</option><option value="3">D</option></select>
                </div>
                <div class="w-2/3">
                    <label class="text-[10px] font-bold text-green-600 uppercase">Solution (Explanation)</label>
                    <input class="w-full p-2 border rounded text-xs q-sol" placeholder="Explain the logic here...">
                </div>
            </div>
        </div>
    </div>`;
    document.getElementById('q-container').insertAdjacentHTML('beforeend', h);
};

// Publish Logic
window.publishExam = async () => {
    const title = document.getElementById('ex-title').value;
    const dur = document.getElementById('ex-dur').value;
    const batch = document.getElementById('ex-batch').value;
    const pos = document.getElementById('ex-pos').value || 4;
    const neg = document.getElementById('ex-neg').value || 1;
    const random = document.getElementById('ex-random').checked;
    
    if(!title || !dur) return alert("Fill Title/Duration");

    let examData = {
        title, duration: parseInt(dur), batch,
        posMarks: parseInt(pos), negMarks: parseInt(neg), randomize: random,
        type: window.examMode === 'pdf' ? 'pdf_exam' : 'native_exam',
        createdAt: serverTimestamp()
    };

    if(window.examMode === 'pdf') {
        const file = document.getElementById('ex-file').files[0];
        if(!file) return alert("Upload PDF");
        const f = new FormData(); f.append('file', file); f.append('upload_preset', 'lms_upload'); // Ensure Cloudinary Preset
        const r = await fetch('https://api.cloudinary.com/v1_1/dpe74ejhl/upload', {method:'POST', body:f});
        const d = await r.json();
        examData.fileUrl = d.secure_url;
        const keys = []; document.querySelectorAll('.pk').forEach(s => keys.push(parseInt(s.value)));
        examData.answerKey = keys;
    } else {
        // Native (Manual or Bulk)
        let finalQs = [];
        if(window.examMode === 'bulk') finalQs = bulkData;
        else {
            document.querySelectorAll('.q-item').forEach(q => {
                const txt = q.querySelector('.q-txt').value;
                const img = q.querySelector('.q-img').value;
                const opts = [0,1,2,3].map(i => q.querySelector(`.q-opt-${i}`).value);
                const ans = parseInt(q.querySelector('.q-ans').value);
                const sol = q.querySelector('.q-sol').value;
                if(txt || img) finalQs.push({ q: txt, img, options: opts, correct: ans, sol });
            });
        }
        if(finalQs.length===0) return alert("No questions!");
        examData.questions = finalQs;
    }

    await addDoc(collection(db,"exams"), examData);
    alert("Published!"); location.reload();
};

window.parseJSON = () => {
    try {
        bulkData = JSON.parse(document.getElementById('json-input').value);
        alert(`Parsed ${bulkData.length} questions.`);
    } catch(e) { alert("Invalid JSON"); }
};

// Utils
window.loadExams = async () => {
    const s = await getDocs(query(collection(db, "exams"), orderBy("createdAt", "desc")));
    document.getElementById('exam-list').innerHTML = s.docs.map(d => `
        <div class="p-4 flex justify-between items-center hover:bg-slate-50">
            <div><span class="font-bold block text-sm">${d.data().title}</span><span class="text-[10px] text-slate-400 bg-white border px-1 rounded">Class ${d.data().batch}</span></div>
            <button onclick="delExam('${d.id}')" class="text-red-400 hover:text-red-600"><i class="fas fa-trash"></i></button>
        </div>`).join('');
};
window.genKeys = () => { const c=document.getElementById('ex-count').value; let h=''; for(let i=0;i<c;i++) h+=`<select class="pk border p-1 text-[10px]"><option value="0">A</option><option value="1">B</option><option value="2">C</option><option value="3">D</option></select>`; document.getElementById('ex-keys').innerHTML=h; };
window.openExamModal = () => { document.getElementById('exam-modal').classList.remove('hidden'); document.getElementById('q-container').innerHTML=''; window.addQuestion(); };
window.delExam = async(id) => { if(confirm("Delete?")) await deleteDoc(doc(db,"exams",id)); loadExams(); };
window.signOutAdmin = () => signOut(auth).then(()=>location.href="index.html");