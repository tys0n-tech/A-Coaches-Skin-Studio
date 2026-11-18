# QA Checklist (ยังต้องทดสอบบน Windows)

- [ ] RUN_WINDOWS.bat ติดตั้ง npm packages และเปิด Electron ได้
- [ ] Scania / Volvo / MAN illustration เปลี่ยนได้และหมุนด้วยเมาส์ได้
- [ ] Import PNG แล้ว render ลายบนตัวอย่าง coach (geometry illustrative)
- [ ] Save PNG ไฟล์เดิมแล้วดูว่า scene auto reload
- [ ] Import sample GLB ที่มี UV และ Mesh ที่รู้จัก
- [ ] เลือก Mesh และ map ภาพบน UV จริง
- [ ] Import DXT1 / DXT5 DDS ในเครื่อง Windows GPU ที่รองรับ
- [ ] Open/Save .cssproj แล้ว path texture/model กลับมาเหมือนเดิม
- [ ] Import template ZIP .scs ที่มี DDS จริง แล้วเลือกรายการ DDS
- [ ] Export PNG ผ่าน Texconv เป็น BC3, ตรวจ output ZIP และ DDS header
- [ ] เปรียบเทียบ filenames/SII/TOBJ ใน ZIP ที่สร้างกับเทมเพลต
- [ ] ติดตั้ง .scs ที่สร้างใน ETS2 แล้วเปิดเมนูปรับแต่งรถ DLC Coaches รุ่นเป้าหมาย
- [ ] ตรวจตำแหน่งลายหน้า/หลัง/ซ้าย/ขวา/roof และ chassis ต่าง ๆ
- [ ] BUILD_EXE_WINDOWS.bat สร้าง portable Windows EXE ได้

Source syntax checks by `node --check` were passed when preparing the release source. Runtime/game compatibility has not been verified without game files and Windows build environment.
