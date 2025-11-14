import * as Excel from 'exceljs';
import { get, set } from 'idb-keyval';

// A simple debounce function
function debounce(func: Function, delay: number) {
  let timeoutId: number;
  return (...args: any[]) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      func(...args);
    }, delay);
  };
}

export class CostDatabaseManager {
  private fileHandle: FileSystemFileHandle | null = null;
  private data: any[] = []; // This will hold the parsed Excel data
  private onDataLoaded: ((data: any[]) => void) | null = null;

  // We'll call this to write data back to the file
  private saveToFile = debounce(async () => {
    if (!this.fileHandle || !this.data.length) return;

    const workbook = new Excel.Workbook();
    const worksheet = workbook.addWorksheet('CostData');

    // Add headers
    worksheet.columns = Object.keys(this.data[0]).map(key => ({ header: key, key }));

    // Add rows
    worksheet.addRows(this.data);

    const buffer = await workbook.xlsx.writeBuffer();
    
    const writable = await this.fileHandle.createWritable();
    await writable.write(buffer);
    await writable.close();
    console.log('Database auto-saved!');
  }, 2000); // Debounce by 2 seconds

  // Tries to load the handle from IndexedDB on startup
  async initialize(onDataLoaded: (data: any[]) => void) {
    this.onDataLoaded = onDataLoaded;
    const storedHandle = await get<FileSystemFileHandle>('cost-db-handle');
    if (storedHandle) {
      // Check if we still have permission
      if ((await storedHandle.queryPermission({ mode: 'readwrite' })) === 'granted') {
        this.fileHandle = storedHandle;
        await this.loadData();
      }
    }
  }

  // Prompts user to select a file
  async connectToFile() {
    try {
        const [handle] = await window.showOpenFilePicker({
            types: [{ description: 'Excel Files', accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] } }],
          });
      
          if (handle) {
            await handle.requestPermission({ mode: 'readwrite' });
            this.fileHandle = handle;
            await set('cost-db-handle', handle); // Save handle for next session
            await this.loadData();
          }
    } catch (error) {
        console.error("Error connecting to file:", error)
    }
  }

  // Reads and parses the data from the file
  async loadData() {
    if (!this.fileHandle) return;
    const file = await this.fileHandle.getFile();
    const buffer = await file.arrayBuffer();

    const workbook = new Excel.Workbook();
    await workbook.xlsx.load(buffer);

    const worksheet = workbook.worksheets[0];
    if (!worksheet) return;

    const jsonData: any[] = [];
    const headerRow = worksheet.getRow(1);
    if (!headerRow.values || !Array.isArray(headerRow.values)) return;

    const headers = headerRow.values.slice(1) as string[];

    worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const rowData: any = {};
        const rowValues = row.values as Excel.CellValue[];
        headers.forEach((header, index) => {
            rowData[header] = rowValues[index + 1];
        });
        jsonData.push(rowData);
    });

    this.data = jsonData;

    if (this.onDataLoaded) {
        this.onDataLoaded(this.data);
    }
  }

  // The UI will call this method when data changes
  updateData(newData: any[]) {
    this.data = newData;
    this.saveToFile(); // Trigger the debounced save
  }

  getData() {
    return this.data;
  }

  isConnected() {
    return !!this.fileHandle;
  }
}
