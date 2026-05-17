/**
 * GOOGLE APPS SCRIPT - Backend for Petrol Record System
 * 
 * SETUP INSTRUCTIONS:
 * 1. Create a new Google Spreadsheet (or use an existing one).
 * 2. Copy the spreadsheet ID from its URL:
 *    https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>/edit
 * 3. Paste your spreadsheet ID into the SPREADSHEET_ID constant below.
 * 4. Go to Extensions > Apps Script inside that spreadsheet.
 * 5. Delete any existing code and paste this entire script.
 * 6. Save the project (Ctrl+S or Cmd+S).
 * 7. Click "Deploy" > "New deployment".
 * 8. Choose type: "Web app".
 * 9. Set "Execute as": Me.
 * 10. Set "Who has access": Anyone.
 * 11. Click "Deploy", authorize when prompted, then copy the Web App URL.
 * 12. Add that URL as the SCRIPT_URL environment variable in Cloudflare Pages.
 */

// Configuration — update SPREADSHEET_ID before deploying
const SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID'; // Paste your Google Sheets spreadsheet ID here
const FOLDER_NAME = 'Petrol Records - Uploaded Files'; // Folder for uploaded files
const HIGHLIGHT_COLOR = '#FFF3CD'; // Light yellow highlight for Oil or Both rows ONLY (not None or Air)

/**
 * doPost - Handles POST requests from the web form
 */
function doPost(e) {
  try {
    // Parse form data
    const params = e.parameter;

    // Block upload if any required field is missing
    const validation = validateSubmissionParams(params);
    if (!validation.isValid) {
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        message: 'Missing data, try again',
        missingFields: validation.missingFields
      })).setMimeType(ContentService.MimeType.JSON);
    }
    
    // Open the SPECIFIC spreadsheet by ID (not the active one)
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    
    // Get or create sheet named e.g. "February 26 1234" (month + year + vehicle last 4); append data
    const sheet = getOrCreateVehicleSheet(params.vehicleNo, params.date, ss);
    
    // Format the date
    const dateStr = formatDateTime(params.date);
    
    // Get the amount directly from form (user-entered total)
    const amount = parseFloat(params.amount) || 0;
    const ratePerLitre = parseFloat(params.rate) || 0;
    const volume = parseFloat(params.volume) || 0;
    
    // Handle file upload if present
    let driveFile = null;
    if (params.fileData && params.fileName) {
      driveFile = saveFileToDrive(params.fileData, params.fileName, params.mimeType, params.vehicleNo, params.date);
    }

    // KM run = current display − last display (floor /10 for 6-digit). Always write to PREVIOUS row (D2), never current row (D3).
    const currentKm = parseFloat(params.kilometer) || null;
    let kmRun = '';
    var lastRowBeforeAppend = sheet.getLastRow();

    const frontendKmRun = params.kmRun !== undefined && params.kmRun !== null && params.kmRun !== '' ? parseFloat(params.kmRun) : null;
    if (frontendKmRun !== null && !isNaN(frontendKmRun)) {
      kmRun = frontendKmRun;
    } else if (currentKm !== null && lastRowBeforeAppend >= 2) {
      const biblicalParam = (params.biblical || '').toString().trim();
      if (biblicalParam) {
        const biblicalNum = parseInt(biblicalParam, 10);
        if (!isNaN(biblicalNum)) {
          const dateObj = new Date(params.date);
          const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'];
          const month = monthNames[dateObj.getMonth()];
          const year = String(dateObj.getFullYear()).slice(-2);
          const vehicle = (params.vehicleNo || '').toString().trim();
          const lastKmResult = getLastKilometerByBiblical(month, year, vehicle, biblicalNum);
          if (lastKmResult.success && lastKmResult.kilometer !== null && !isNaN(lastKmResult.kilometer)) {
            kmRun = Math.floor(currentKm / 10) - Math.floor(lastKmResult.kilometer / 10);
          }
        }
      }
      if (kmRun === '') {
        const prevKmVal = sheet.getRange(lastRowBeforeAppend, 3).getValue();
        const prevKm = prevKmVal !== '' && prevKmVal !== null ? parseFloat(prevKmVal) : null;
        if (prevKm !== null && !isNaN(prevKm)) {
          kmRun = Math.floor(currentKm / 10) - Math.floor(prevKm / 10);
        }
      }
    }

    if (kmRun !== '' && lastRowBeforeAppend >= 2) {
      sheet.getRange(lastRowBeforeAppend, 4).setValue(kmRun);
    }

    // Cross-month KM run: if current month's sheet has no prior data row,
    // pull last month's last kilometer and write KM run into LAST MONTH's last row.
    if (currentKm !== null && lastRowBeforeAppend < 2) {
      const prevMonthInfo = getPreviousMonthSheet(params.date, params.vehicleNo, ss);
      if (prevMonthInfo && prevMonthInfo.sheet) {
        const prevSheet = prevMonthInfo.sheet;
        const prevLastRow = prevSheet.getLastRow();
        if (prevLastRow >= 2) {
          const prevKmVal = prevSheet.getRange(prevLastRow, 3).getValue();
          const prevKm = prevKmVal !== '' && prevKmVal !== null ? parseFloat(prevKmVal) : null;
          if (prevKm !== null && !isNaN(prevKm)) {
            const existingPrevKmRun = prevSheet.getRange(prevLastRow, 4).getValue();
            if (existingPrevKmRun === '' || existingPrevKmRun === null) {
              const crossMonthKmRun = Math.floor(currentKm / 10) - Math.floor(prevKm / 10);
              prevSheet.getRange(prevLastRow, 4).setValue(crossMonthKmRun);
              Logger.log('Cross-month KM run written to ' + prevSheet.getName() +
                ' row ' + prevLastRow + ': ' + crossMonthKmRun);
            }
          }
        }
      }
    }

    // New row: D (KM run) is always empty — KM run is stored in the previous row only.
    const rowData = [
      dateStr,                                    // A: Date
      amount.toFixed(2),                         // B: Amount
      currentKm !== null ? currentKm : '',        // C: Kilo meter
      '',                                         // D: KM run (always empty; we wrote to previous row)
      parseFloat(params.volume) || '',           // E: Volume litre
      params.petrolBunk || '',                   // F: Petrol bunk
      parseFloat(params.density) || '',          // G: Density
      ratePerLitre.toFixed(2),                   // H: Rate (per litre)
      params.location || '',                     // I: Location
      params.oilChange || 'None',                // J: Oil/Air change (None, Air, Oil, Both)
      params.petrolType || '',                   // K: Petrol Type
      driveFile ? driveFile.url : ''             // L: File URL (replaced by IMAGE formula if file)
    ];

    // Append data to sheet
    sheet.appendRow(rowData);
    const lastRow = sheet.getLastRow();
    
    // Insert image into column L (12) if file exists
    if (driveFile && driveFile.file) {
      insertImageIntoCell(sheet, lastRow, 12, driveFile.file);
    }
    
    // Highlight row ONLY if Oil or Both is marked (not None or Air)
    if (params.oilChange && (params.oilChange === 'Oil' || params.oilChange === 'Both')) {
      highlightServiceRow(sheet, lastRow);
    }
    
    // Log success
    Logger.log('Data added successfully to sheet: ' + sheet.getName());
    
    // Return success response
    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      message: 'Data saved successfully to ' + sheet.getName(),
      row: lastRow,
      sheet: sheet.getName()
    })).setMimeType(ContentService.MimeType.JSON);
    
  } catch (error) {
    Logger.log('Error: ' + error.toString());
    
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Validate mandatory form fields before any write operation.
 * If something is missing, caller must stop and return error.
 */
function validateSubmissionParams(params) {
  const requiredFields = [
    'date',
    'vehicleNo',
    'amount',
    'kilometer',
    'volume',
    'petrolBunk',
    'density',
    'rate',
    'location',
    'oilChange',
    'petrolType',
    'fileData',
    'fileName',
    'mimeType'
  ];

  const missingFields = requiredFields.filter(function(field) {
    const value = params[field];
    return value === undefined || value === null || String(value).trim() === '';
  });

  return {
    isValid: missingFields.length === 0,
    missingFields: missingFields
  };
}

/**
 * doGet - Handles GET requests.
 * Query params for sheet data: month, year, vehicle (full form e.g. TN12AA1234)
 * - biblical=N: get last record's kilometer where biblical number equals N (for KM run calculation).
 * - LR=1: exclude last row, return previous record info.
 */
function doGet(e) {
  const params = e && e.parameter ? e.parameter : {};
  const action = (params.action || '').toString().trim();
  const month = (params.month || '').toString().trim();
  const year = (params.year || '').toString().trim();
  const vehicle = (params.vehicle || params.vehicleNo || '').toString().trim();
  const lr = params.LR || params.lr || '';
  const biblicalParam = (params.biblical || '').toString().trim();

  // Update image URL in an existing row without deleting/reinserting row.
  // Required params: action=updateImage, month, vehicle, date, and (fileId or imageUrl)
  if (action === 'updateImage') {
    const updateResult = updateImageForExistingRecord(params);
    return ContentService.createTextOutput(JSON.stringify(updateResult))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (month && vehicle && biblicalParam) {
    const biblicalNum = parseInt(biblicalParam, 10);
    if (!isNaN(biblicalNum)) {
      const result = getLastKilometerByBiblical(month, year, vehicle, biblicalNum);
      return ContentService.createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }

  if (month && vehicle) {
    const result = getSheetDataAsJson(month, year, vehicle, lr ? true : false);
    // When LR=1, return simplified response: success, vehicle, sheet, km, date, endpointQuery
    if (lr && result.success && result.previousRecord) {
      const lastDataRow = result.data && result.data.length > 0 ? result.data[result.data.length - 1] : null;
      const simplified = {
        success: true,
        vehicle: result.vehicle,
        sheet: result.sheet,
        km: result.previousRecord.biblicalNumber,
        date: lastDataRow ? lastDataRow.date : null,
        endpointQuery: result.endpointQuery || ''
      };
      return ContentService.createTextOutput(JSON.stringify(simplified))
        .setMimeType(ContentService.MimeType.JSON);
    }
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  }

  return ContentService.createTextOutput(JSON.stringify({
    status: 'API is running',
    message: 'Send POST for form submit. GET: month, year, vehicle. Add biblical=N for last kilometer by biblical number; add LR=1 for previous record. Add action=updateImage to set missing image for an existing row.',
    example: '?month=February&year=26&vehicle=TN12AA1234',
    exampleBiblical: '?month=February&year=26&vehicle=TN12AA1234&biblical=45228',
    exampleLR: '?month=February&year=26&vehicle=TN12AA1234&LR=1',
    exampleUpdateImage: '?action=updateImage&month=March%2026&vehicle=6518&date=18-03-26:18:47:49&fileId=YOUR_DRIVE_FILE_ID',
    timestamp: new Date().toISOString()
  })).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Add/update missing image in an existing record.
 * Finds row by date in the target sheet and writes IMAGE formula in column L.
 */
function updateImageForExistingRecord(params) {
  const month = (params.month || '').toString().trim();
  const year = (params.year || '').toString().trim();
  const vehicle = (params.vehicle || params.vehicleNo || '').toString().trim();
  const date = (params.date || '').toString().trim();
  const fileId = (params.fileId || '').toString().trim();
  const imageUrlInput = (params.imageUrl || '').toString().trim();

  if (!month || !vehicle || !date) {
    return {
      success: false,
      message: 'Missing data, try again',
      missingFields: ['month', 'vehicle', 'date']
    };
  }

  if (!fileId && !imageUrlInput) {
    return {
      success: false,
      message: 'Missing data, try again',
      missingFields: ['fileId or imageUrl']
    };
  }

  const imageUrl = fileId
    ? 'https://drive.google.com/uc?export=view&id=' + fileId
    : imageUrlInput;

  const sheetName = buildSheetNameFromParams(month, year, vehicle);
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    return {
      success: false,
      message: 'Sheet not found',
      sheet: sheetName
    };
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return {
      success: false,
      message: 'No records found in sheet',
      sheet: sheetName
    };
  }

  const dateColumn = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  let targetRow = -1;
  for (var i = 0; i < dateColumn.length; i++) {
    if (String(dateColumn[i][0]).trim() === date) {
      targetRow = i + 2;
      break;
    }
  }

  if (targetRow === -1) {
    return {
      success: false,
      message: 'Record not found for given date',
      sheet: sheetName,
      date: date
    };
  }

  const imageCell = sheet.getRange(targetRow, 12);
  imageCell.setFormula('=IMAGE("' + imageUrl + '", 1)');
  sheet.setRowHeight(targetRow, 100);

  return {
    success: true,
    message: 'Image updated successfully',
    sheet: sheetName,
    row: targetRow,
    date: date,
    imageUrl: imageUrl
  };
}

/**
 * Convert 6-digit kilometer to biblical number (remove last digit). e.g. 452281 -> 45228.
 */
function kmToBiblical(km) {
  if (km === '' || km === null || isNaN(parseFloat(km))) return null;
  var kmStr = String(Math.floor(parseFloat(km)));
  return kmStr.length >= 1 ? parseInt(kmStr.slice(0, -1), 10) : null;
}

/**
 * Get the last record's kilometer in the sheet where biblical number matches.
 * Used to compute KM run = current_km - this_km when user supplies biblical number.
 */
function getLastKilometerByBiblical(month, year, vehicle, biblicalNum) {
  const sheetName = buildSheetNameFromParams(month, year, vehicle);
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    return { success: false, error: 'Sheet not found', kilometer: null };
  }
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return { success: true, kilometer: null, message: 'No records' };
  }
  const kmValues = sheet.getRange(2, 3, lastRow, 3).getValues();
  for (var r = kmValues.length - 1; r >= 0; r--) {
    var val = kmValues[r][0];
    if (val === '' || val === null) continue;
    var km = parseFloat(val);
    if (isNaN(km)) continue;
    if (kmToBiblical(km) === biblicalNum) {
      return { success: true, kilometer: km };
    }
  }
  return { success: true, kilometer: null, message: 'No matching record for biblical ' + biblicalNum };
}

/**
 * Get image URL from sheet cell. Column K (old) or L (new) holds either =IMAGE("url", 1) or plain URL text.
 * getValues() does not return the URL for IMAGE formula cells, so we read the formula and extract it.
 */
function getImageUrlFromCell(cellValue, cellFormula) {
  if (cellFormula && typeof cellFormula === 'string' && cellFormula.indexOf('=IMAGE("') === 0) {
    var match = cellFormula.match(/^=IMAGE\("([^"]+)"/);
    return match ? match[1] : '';
  }
  if (cellValue && typeof cellValue === 'string' && cellValue.indexOf('http') === 0) {
    return cellValue;
  }
  return '';
}

/**
 * Detect if sheet row uses old 11-column layout (no "KM run" column).
 * Old: D=Volume, E=Petrol bunk (string), F=Density, ... K=Image.
 * New: D=KM run, E=Volume, F=Petrol bunk, ... L=Image.
 * Heuristic: column E is Petrol bunk (string) in old, Volume (number) in new.
 */
function isOldSheetLayout(row) {
  if (!row || row.length < 5) return false;
  var colE = row[4];
  if (colE === '' || colE === null || colE === undefined) return false;
  if (typeof colE === 'number' && !isNaN(colE)) return false;
  var asNum = parseFloat(colE);
  if (typeof colE === 'string' && colE.trim() !== '' && isNaN(asNum)) return true;
  if (typeof colE === 'string' && !isNaN(asNum) && asNum > 100) return false;
  if (typeof colE === 'string' && colE.length > 2) return true;
  return false;
}

/**
 * Build sheet name from month, year, vehicle. Sheet names are like "February 26 1234".
 */
function buildSheetNameFromParams(month, year, vehicle) {
  const last4 = getVehicleLast4(vehicle);
  if (year) {
    return month + ' ' + year + ' ' + last4;
  }
  return month + ' ' + last4;
}

/**
 * Get all data from a sheet (by month + vehicle) as JSON list.
 * vehicle: full form e.g. TN12AA1234 (last 4 digits used to find sheet "February 26 1234").
 * excludeLastRecord (LR): when true, data excludes the last row and result includes previousRecord
 *   with kilometer (previous row only), biblicalNumber (6-digit km with last digit removed), dateOfMonth.
 */
function getSheetDataAsJson(month, year, vehicle, excludeLastRecord) {
  const sheetName = buildSheetNameFromParams(month, year, vehicle);
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    return {
      success: false,
      error: 'Sheet not found',
      vehicle: vehicle,
      sheet: sheetName,
      data: []
    };
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return {
      success: true,
      vehicle: vehicle,
      sheet: sheetName,
      count: 0,
      data: [],
      previousRecord: null
    };
  }

  const values = sheet.getRange(2, 1, lastRow, 12).getValues();
  const formulasCol12 = sheet.getRange(2, 12, lastRow, 12).getFormulas();
  const formulasCol11 = sheet.getRange(2, 11, lastRow, 11).getFormulas();
  const data = [];
  for (var i = 0; i < values.length; i++) {
    if (excludeLastRecord && i === values.length - 1) break;
    var row = values[i];
    var dateVal = row[0];
    var amountVal = row[1];
    if (dateVal === '' && (amountVal === '' || amountVal === null)) {
      continue;
    }
    var isOldLayout = isOldSheetLayout(row);
    var imageUrl;
    var kmRunVal, volumeLitreVal, petrolBunkVal, densityVal, rateVal, locationVal, oilAirVal, petrolTypeVal;
    if (isOldLayout) {
      imageUrl = getImageUrlFromCell(row[10], formulasCol11[i] ? formulasCol11[i][0] : '');
      kmRunVal = null;
      volumeLitreVal = row[3] !== '' && row[3] !== null ? parseFloat(row[3]) : null;
      petrolBunkVal = row[4] || '';
      densityVal = row[5] !== '' && row[5] !== null ? parseFloat(row[5]) : null;
      rateVal = row[6] !== '' && row[6] !== null ? parseFloat(row[6]) : null;
      locationVal = row[7] || '';
      oilAirVal = row[8] || 'None';
      petrolTypeVal = row[9] || '';
    } else {
      imageUrl = getImageUrlFromCell(row[11], formulasCol12[i] ? formulasCol12[i][0] : '');
      kmRunVal = row[3] !== '' && row[3] !== null ? parseFloat(row[3]) : null;
      volumeLitreVal = row[4] !== '' && row[4] !== null ? parseFloat(row[4]) : null;
      petrolBunkVal = row[5] || '';
      densityVal = row[6] !== '' && row[6] !== null ? parseFloat(row[6]) : null;
      rateVal = row[7] !== '' && row[7] !== null ? parseFloat(row[7]) : null;
      locationVal = row[8] || '';
      oilAirVal = row[9] || 'None';
      petrolTypeVal = row[10] || '';
    }
    data.push({
      date: dateVal,
      amount: amountVal !== '' && amountVal !== null ? parseFloat(amountVal) : null,
      kiloMeter: row[2] !== '' && row[2] !== null ? parseFloat(row[2]) : null,
      kmRun: kmRunVal,
      volumeLitre: volumeLitreVal,
      petrolBunk: petrolBunkVal,
      density: densityVal,
      rate: rateVal,
      location: locationVal,
      oilAirChange: oilAirVal,
      petrolType: petrolTypeVal,
      imageUrl: imageUrl
    });
  }

  var previousRecord = null;
  if (excludeLastRecord && values.length >= 2) {
    var prevRow = values[values.length - 2];
    var prevKmVal = prevRow[2];
    var prevKm = prevKmVal !== '' && prevKmVal !== null ? parseFloat(prevKmVal) : null;
    if (prevKm !== null && !isNaN(prevKm)) {
      var kmStr = String(Math.floor(prevKm));
      var biblicalNumber = kmStr.length >= 6 ? parseInt(kmStr.slice(0, -1), 10) : parseInt(kmStr, 10);
      var dateOfMonth = null;
      var dateCell = prevRow[0];
      if (dateCell) {
        if (typeof dateCell === 'object' && dateCell.getDate) {
          dateOfMonth = dateCell.getDate();
        } else {
          var parts = String(dateCell).trim().split(/[-:\/]/);
          if (parts.length >= 1) dateOfMonth = parseInt(parts[0], 10) || null;
        }
      }
      previousRecord = {
        kilometer: prevKm,
        biblicalNumber: biblicalNumber,
        dateOfMonth: dateOfMonth
      };
    }
  }

  var result = {
    success: true,
    vehicle: vehicle,
    sheet: sheetName,
    count: data.length,
    data: data
  };
  if (excludeLastRecord) {
    result.LR = true;
    result.previousRecord = previousRecord;
    if (previousRecord) {
      result.endpointQuery = 'dateOfMonth=' + (previousRecord.dateOfMonth != null ? previousRecord.dateOfMonth : '') +
        '&biblical=' + previousRecord.biblicalNumber + '&LR=1';
    }
  }
  return result;
}

/**
 * Initialize sheet with headers (no Vehicle No - each sheet is for one vehicle)
 */
function initializeSheet(sheet) {
  const headers = [
    'Date',           // A
    'Amount',         // B - Total Amount Paid
    'Kilo meter',     // C
    'KM run',         // D - KM since previous record
    'Volume litre',   // E
    'Petrol bunk',    // F
    'Density',        // G
    'Rate',           // H - Rate per litre
    'Location',       // I
    'Oil / Air Change', // J - None, Air, Oil, Both
    'Petrol Type',    // K - Normal / Power Petrol
    'Image'           // L
  ];
  
  sheet.appendRow(headers);
  
  // Format header row
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#667eea');
  headerRange.setFontColor('#ffffff');
  headerRange.setHorizontalAlignment('center');
  
  // Set column widths (12 columns)
  sheet.setColumnWidth(1, 150);  // Date
  sheet.setColumnWidth(2, 120);  // Amount
  sheet.setColumnWidth(3, 120);  // Kilo meter
  sheet.setColumnWidth(4, 100);  // KM run
  sheet.setColumnWidth(5, 120);  // Volume litre
  sheet.setColumnWidth(6, 150);  // Petrol bunk
  sheet.setColumnWidth(7, 100);  // Density
  sheet.setColumnWidth(8, 100);  // Rate (per litre)
  sheet.setColumnWidth(9, 150);  // Location
  sheet.setColumnWidth(10, 130); // Oil/Air change
  sheet.setColumnWidth(11, 130); // Petrol Type
  sheet.setColumnWidth(12, 150); // Image
  
  // Set row height for header
  sheet.setRowHeight(1, 35);
  
  // Freeze header row
  sheet.setFrozenRows(1);
  
  Logger.log('Sheet initialized: ' + sheet.getName());
}

/**
 * Format date and time
 */
function formatDateTime(dateTimeStr) {
  if (!dateTimeStr) {
    return new Date().toLocaleString('en-IN', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
  }
  
  const date = new Date(dateTimeStr);
  
  // Format: DD-MM-YY:HH:MM:SS
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = String(date.getFullYear()).slice(-2);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  
  return `${day}-${month}-${year}:${hours}:${minutes}:${seconds}`;
}

/**
 * Save uploaded file to Google Drive. Path: Main folder / February 26 / Vehicle_1234 / file
 * File and folders are shared "Anyone with the link can view" so links work when Drive is private.
 * Deploy web app as "Execute as: Me" so the script owner's Drive permissions apply.
 */
function saveFileToDrive(base64Data, fileName, mimeType, vehicleNo, date) {
  try {
    // Get or create folder: Main / "February 26" / "Vehicle_1234" (folders are shared when created)
    const folder = getOrCreateVehicleFolder(vehicleNo, date);
    
    // Decode base64
    const decodedData = Utilities.base64Decode(base64Data);
    const blob = Utilities.newBlob(decodedData, mimeType, fileName);
    
    // Create timestamp for unique filename
    const timestamp = new Date().getTime();
    const uniqueFileName = `${timestamp}_${fileName}`;
    
    // Save file
    const file = folder.createFile(blob);
    file.setName(uniqueFileName);
    file.setDescription('Uploaded via Petrol Record Form on ' + new Date().toLocaleString());
    
    // Make file accessible to anyone with the link (required for private Drive)
    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (shareErr) {
      Logger.log('File setSharing note: ' + shareErr.toString());
    }
    
    Logger.log('File saved to: ' + folder.getName() + '/' + uniqueFileName);
    
    // Return both the file URL and the file object itself
    return {
      url: file.getUrl(),
      file: file,
      fileId: file.getId()
    };
    
  } catch (error) {
    Logger.log('File upload error: ' + error.toString());
    return null;
  }
}

/**
 * Insert image into a specific cell using IMAGE formula
 */
function insertImageIntoCell(sheet, row, column, file) {
  try {
    // Get the cell
    const cell = sheet.getRange(row, column);
    
    // Set row height to accommodate image
    sheet.setRowHeight(row, 100);
    
    // Get the file's public URL for IMAGE formula
    // Make sure file is shared with "Anyone with link"
    const fileUrl = file.getUrl();
    const fileId = file.getId();
    
    // Use Google Drive direct link format for IMAGE formula
    const imageUrl = `https://drive.google.com/uc?export=view&id=${fileId}`;
    
    // Insert IMAGE formula into cell
    const formula = `=IMAGE("${imageUrl}", 1)`;
    cell.setFormula(formula);
    
    Logger.log('Image inserted into cell ' + cell.getA1Notation() + ' using formula');
    
  } catch (error) {
    Logger.log('Image insertion error: ' + error.toString());
    // Fallback: just put the link
    const cell = sheet.getRange(row, column);
    cell.setValue(file.getUrl());
  }
}

/**
 * Highlight entire row when Oil or Both is marked (NOT None or Air)
 * This replaces the old highlightOilChangeRow function
 */
function highlightServiceRow(sheet, rowNumber) {
  try {
    // Get the entire row range (columns A to L - 12 columns)
    // getRange(row, column, numRows, numColumns) - 3rd/4th args are COUNT, not end row/col
    const rowRange = sheet.getRange(rowNumber, 1, 1, 12);
    
    // Set background color (light yellow)
    rowRange.setBackground(HIGHLIGHT_COLOR);
    
    // Optional: Make text bold
    rowRange.setFontWeight('bold');
    
    Logger.log('Highlighted service row: ' + rowNumber);
    
  } catch (error) {
    Logger.log('Row highlight error: ' + error.toString());
  }
}

/**
 * Get or create folder in Google Drive. New folders are shared "Anyone with the link can view".
 */
function getOrCreateFolder(folderName) {
  const folders = DriveApp.getFoldersByName(folderName);
  
  if (folders.hasNext()) {
    return folders.next();
  }
  const folder = DriveApp.createFolder(folderName);
  try {
    folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e) { Logger.log('Folder share: ' + e); }
  return folder;
}

/**
 * Get or create folder path: Main / "February 26" / "Vehicle_1234"
 * New folders are shared "Anyone with the link can view" so file links work.
 */
function getOrCreateVehicleFolder(vehicleNo, date) {
  const mainFolder = getOrCreateFolder(FOLDER_NAME);
  const dateObj = new Date(date);
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                     'July', 'August', 'September', 'October', 'November', 'December'];
  const monthFolderName = monthNames[dateObj.getMonth()] + ' ' + dateObj.getFullYear().toString().slice(-2);
  const monthFolders = mainFolder.getFoldersByName(monthFolderName);
  let monthFolder;
  if (monthFolders.hasNext()) {
    monthFolder = monthFolders.next();
  } else {
    monthFolder = mainFolder.createFolder(monthFolderName);
    try { monthFolder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
    Logger.log('Created month folder: ' + monthFolderName);
  }
  const vehicleFolderName = getVehicleKey(vehicleNo);
  const existing = monthFolder.getFoldersByName(vehicleFolderName);
  if (existing.hasNext()) {
    return existing.next();
  }
  const newFolder = monthFolder.createFolder(vehicleFolderName);
  try { newFolder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
  Logger.log('Created vehicle folder: ' + monthFolderName + '/' + vehicleFolderName);
  return newFolder;
}

/**
 * Get or create monthly subfolder inside main folder (kept for backward compatibility)
 * Format: "Petrol Records - Uploaded Files/January 25"
 */
function getOrCreateMonthlyFolder(date) {
  const mainFolder = getOrCreateFolder(FOLDER_NAME);
  const dateObj = new Date(date);
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                     'July', 'August', 'September', 'October', 'November', 'December'];
  const monthName = monthNames[dateObj.getMonth()];
  const year = dateObj.getFullYear().toString().slice(-2);
  const monthFolderName = `${monthName} ${year}`;
  const monthFolders = mainFolder.getFoldersByName(monthFolderName);
  if (monthFolders.hasNext()) {
    return monthFolders.next();
  }
  const newFolder = mainFolder.createFolder(monthFolderName);
  Logger.log('Created monthly folder: ' + monthFolderName);
  return newFolder;
}

/**
 * Get last 4 digits from vehicle number (e.g. "TN12AA1234" or "Jan 26 1234" -> "1234").
 */
function getVehicleLast4(vehicleNo) {
  if (!vehicleNo || !vehicleNo.toString().trim()) {
    return '????';
  }
  const digits = vehicleNo.toString().trim().replace(/\D/g, '');
  const last4 = digits.slice(-4);
  return last4.length >= 4 ? last4 : '????';
}

/**
 * Get a safe sheet/folder name from vehicle number for Drive folder.
 * Uses last 4 digits e.g. "Vehicle_1234". Sheet names use getVehicleSheetName(date, vehicleNo) instead.
 */
function getVehicleKey(vehicleNo) {
  const last4 = getVehicleLast4(vehicleNo);
  return last4 === '????' ? 'Vehicle_Unknown' : 'Vehicle_' + last4;
}

/**
 * Get sheet name in format "February 26 1234" (Month + 2-digit year + vehicle last 4 digits).
 * Depends on date and vehicle number.
 */
function getVehicleSheetName(date, vehicleNo) {
  const dateObj = new Date(date);
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                     'July', 'August', 'September', 'October', 'November', 'December'];
  const monthName = monthNames[dateObj.getMonth()];
  const year = dateObj.getFullYear().toString().slice(-2);
  const last4 = getVehicleLast4(vehicleNo);
  return monthName + ' ' + year + ' ' + last4;
}

/**
 * Find the previous month's sheet for the same vehicle.
 * e.g. current date in March 26 -> looks for "February 26 1234".
 * Returns { sheet, sheetName } or null if not found.
 */
function getPreviousMonthSheet(date, vehicleNo, spreadsheet) {
  const ss = spreadsheet || SpreadsheetApp.openById(SPREADSHEET_ID);
  const dateObj = new Date(date);
  const prevMonthDate = new Date(dateObj.getFullYear(), dateObj.getMonth() - 1, 1);
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                     'July', 'August', 'September', 'October', 'November', 'December'];
  const monthName = monthNames[prevMonthDate.getMonth()];
  const year = prevMonthDate.getFullYear().toString().slice(-2);
  const last4 = getVehicleLast4(vehicleNo);
  const sheetName = monthName + ' ' + year + ' ' + last4;
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return null;
  return { sheet: sheet, sheetName: sheetName };
}

/**
 * Get or create a sheet for this vehicle and date. Sheet name e.g. "February 26 1234".
 * If sheet exists, append to it; if not, create it then append.
 */
function getOrCreateVehicleSheet(vehicleNo, date, spreadsheet) {
  const ss = spreadsheet || SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheetName = getVehicleSheetName(date, vehicleNo);
  
  let sheet = ss.getSheetByName(sheetName);
  
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    initializeSheet(sheet);
    Logger.log('Created new sheet: ' + sheetName);
  } else {
    ensureKmRunColumn(sheet);
  }
  
  return sheet;
}

/**
 * If sheet has only 11 columns (old layout), insert "KM run" at column D and set header.
 */
function ensureKmRunColumn(sheet) {
  const lastCol = sheet.getLastColumn();
  if (lastCol >= 12) return;
  sheet.insertColumnBefore(4);
  sheet.getRange(1, 4).setValue('KM run');
  sheet.getRange(1, 4).setFontWeight('bold').setBackground('#667eea').setFontColor('#ffffff').setHorizontalAlignment('center');
  Logger.log('Inserted KM run column in existing sheet: ' + sheet.getName());
}

/**
 * Get or create monthly sheet based on current date
 * Format: "January 25", "February 25", etc.
 */
function getOrCreateMonthlySheet(date, spreadsheet) {
  // If spreadsheet not provided, use the configured one
  const ss = spreadsheet || SpreadsheetApp.openById(SPREADSHEET_ID);
  
  // Parse date to get month and year
  const dateObj = new Date(date);
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                     'July', 'August', 'September', 'October', 'November', 'December'];
  
  const monthName = monthNames[dateObj.getMonth()];
  const year = dateObj.getFullYear().toString().slice(-2); // Get last 2 digits of year
  
  const sheetName = `${monthName} ${year}`;
  
  // Check if sheet exists
  let sheet = ss.getSheetByName(sheetName);
  
  if (!sheet) {
    // Create new sheet for this month
    sheet = ss.insertSheet(sheetName);
    initializeSheet(sheet);
    Logger.log('Created new monthly sheet: ' + sheetName);
  }
  
  return sheet;
}

/**
 * Test function - Run this to test the setup
 */
function testSetup() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const testDate = new Date().toISOString();
  const sheet = getOrCreateVehicleSheet('TN01AB1234', testDate, ss);
  
  Logger.log('Testing with sheet: ' + sheet.getName());
  Logger.log('Spreadsheet: ' + ss.getName());
  Logger.log('Spreadsheet ID: ' + SPREADSHEET_ID);
  
  // Test data (12 columns - no Vehicle No; KM run computed from previous row)
  const testData1 = [
    formatDateTime(testDate), '526.88', '415615', '', '5.26', 'HP Station', '0.740', '100.17', 'Chennai', 'None', 'Normal', ''
  ];
  sheet.appendRow(testData1);
  Logger.log('Test data 1 (None) added - No highlight');
  
  const testData2 = [
    formatDateTime(testDate), '486.81', '441932', '26317', '4.83', 'HP', '742.6', '100.79', 'Chennai', 'Air', 'Power Petrol', ''
  ];
  sheet.appendRow(testData2);
  Logger.log('Test data 2 (Air) added - NO highlight');
  
  const testData3 = [
    formatDateTime(testDate), '512.30', '442150', '218', '5.10', 'HP', '745.2', '100.45', 'Chennai', 'Oil', 'Normal', ''
  ];
  sheet.appendRow(testData3);
  highlightServiceRow(sheet, sheet.getLastRow());
  Logger.log('Test data 3 (Oil) added and highlighted');
  
  const testData4 = [
    formatDateTime(testDate), '498.75', '442368', '218', '4.95', 'HP', '748.1', '100.76', 'Chennai', 'Both', 'Power Petrol', ''
  ];
  sheet.appendRow(testData4);
  highlightServiceRow(sheet, sheet.getLastRow());
  Logger.log('Test data 4 (Both) added and highlighted');
}

/**
 * Create sheets for specific months - useful for setup
 */
function createMonthlySheets() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  
  Logger.log('Working with spreadsheet: ' + ss.getName());
  Logger.log('Spreadsheet ID: ' + SPREADSHEET_ID);
  
  // Create sheets for common months
  const dates = [
    '2025-01-01',  // January 25
    '2025-02-01',  // February 25
    '2025-03-01',  // March 25
    '2025-04-01',  // April 25
    '2025-05-01',  // May 25
    '2025-06-01',  // June 25
    '2026-01-01',  // January 26
  ];
  
  dates.forEach(dateStr => {
    const sheet = getOrCreateMonthlySheet(dateStr, ss);
    Logger.log('Created/verified sheet: ' + sheet.getName());
  });
  
  Logger.log('Monthly sheets setup complete!');
}

/**
 * List all monthly sheets
 */
function listAllSheets() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheets = ss.getSheets();
  
  Logger.log('Spreadsheet: ' + ss.getName());
  Logger.log('Spreadsheet ID: ' + SPREADSHEET_ID);
  Logger.log('Total sheets: ' + sheets.length);
  sheets.forEach(sheet => {
    Logger.log('- ' + sheet.getName() + ' (Rows: ' + sheet.getLastRow() + ')');
  });
}

/**
 * Clear all data from current month sheet (except headers) - Use with caution!
 */
function clearCurrentMonthData() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = getOrCreateMonthlySheet(new Date().toISOString(), ss);
  
  if (sheet) {
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      sheet.deleteRows(2, lastRow - 1);
      Logger.log('All data cleared from: ' + sheet.getName());
    }
    
    // Also clear all images
    const images = sheet.getImages();
    images.forEach(image => {
      sheet.removeImage(image);
    });
    Logger.log('Images cleared: ' + images.length);
  }
}

/**
 * Clear all images from the sheet
 */
function clearAllImages() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = getOrCreateMonthlySheet(new Date().toISOString(), ss);
  
  if (sheet) {
    const images = sheet.getImages();
    images.forEach(image => {
      sheet.removeImage(image);
    });
    Logger.log('All images cleared: ' + images.length + ' from ' + sheet.getName());
  }
}

/**
 * Get statistics for all vehicle sheets - Run this to see summary
 */
function getStatistics() {
  getAllStatistics();
}

/**
 * Get statistics for a single sheet (helper)
 */
function getSheetStatistics(sheet) {
  if (!sheet) return;
  Logger.log('=== Statistics for: ' + sheet.getName() + ' ===');
  const lastRow = sheet.getLastRow();
  Logger.log('Total records: ' + (lastRow > 1 ? lastRow - 1 : 0));
  if (lastRow <= 1) return;
  const dataRange = sheet.getRange(2, 1, lastRow, 12);
    const values = dataRange.getValues();
    
    let totalAmount = 0;
    let totalVolume = 0;
    let serviceCount = {
      None: 0,
      Air: 0,
      Oil: 0,
      Both: 0
    };
    let normalCount = 0;
    let powerPetrolCount = 0;
    
    values.forEach(row => {
      totalAmount += parseFloat(row[1]) || 0;
      totalVolume += parseFloat(row[4]) || 0;
      const serviceType = row[9] || 'None';  // J: Oil/Air change
      if (serviceCount.hasOwnProperty(serviceType)) {
        serviceCount[serviceType]++;
      }
      if (row[10] && row[10].toString().toLowerCase().includes('normal')) {
        normalCount++;
      } else if (row[10] && row[10].toString().toLowerCase().includes('power')) {
        powerPetrolCount++;
      }
    });
    
    Logger.log('Total amount spent: ₹' + totalAmount.toFixed(2));
    Logger.log('Total volume: ' + totalVolume.toFixed(2) + ' litres');
    Logger.log('Average rate: ₹' + (totalAmount / totalVolume).toFixed(2) + '/L');
    Logger.log('Service counts:');
    Logger.log('  None: ' + serviceCount.None);
    Logger.log('  Air: ' + serviceCount.Air);
    Logger.log('  Oil: ' + serviceCount.Oil);
    Logger.log('  Both: ' + serviceCount.Both);
    Logger.log('Normal petrol fills: ' + normalCount);
    Logger.log('Power petrol fills: ' + powerPetrolCount);
}

function _getStatisticsSingleSheet(sheet) {
  if (!sheet) return null;
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { records: 0, totalAmount: 0, totalVolume: 0, serviceCount: { None: 0, Air: 0, Oil: 0, Both: 0 }, normalCount: 0, powerPetrolCount: 0 };
  const dataRange = sheet.getRange(2, 1, lastRow, 12);
  const values = dataRange.getValues();
  let totalAmount = 0, totalVolume = 0, serviceCount = { None: 0, Air: 0, Oil: 0, Both: 0 }, normalCount = 0, powerPetrolCount = 0;
  values.forEach(row => {
    totalAmount += parseFloat(row[1]) || 0;
    totalVolume += parseFloat(row[4]) || 0;
    const serviceType = row[9] || 'None';
    if (serviceCount.hasOwnProperty(serviceType)) serviceCount[serviceType]++;
    if (row[10] && row[10].toString().toLowerCase().includes('normal')) normalCount++;
    else if (row[10] && row[10].toString().toLowerCase().includes('power')) powerPetrolCount++;
  });
  return { records: lastRow - 1, totalAmount, totalVolume, serviceCount, normalCount, powerPetrolCount };
}

/**
 * Get statistics for ALL sheets (vehicle sheets)
 */
function getAllStatistics() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheets = ss.getSheets();
  
  Logger.log('=== ALL SHEETS STATISTICS ===');
  Logger.log('Spreadsheet: ' + ss.getName());
  Logger.log('Spreadsheet ID: ' + SPREADSHEET_ID);
  
  let grandTotal = 0;
  let grandVolume = 0;
  let totalServiceCount = {
    None: 0,
    Air: 0,
    Oil: 0,
    Both: 0
  };
  
  sheets.forEach(sheet => {
    const lastRow = sheet.getLastRow();
    
    if (lastRow > 1) {
      const dataRange = sheet.getRange(2, 1, lastRow, 12);
      const values = dataRange.getValues();
      
      let sheetTotal = 0;
      let sheetVolume = 0;
      let sheetServiceCount = {
        None: 0,
        Air: 0,
        Oil: 0,
        Both: 0
      };
      let sheetNormal = 0;
      let sheetPower = 0;
      
      values.forEach(row => {
        sheetTotal += parseFloat(row[1]) || 0;
        sheetVolume += parseFloat(row[4]) || 0;
        const serviceType = row[9] || 'None';
        if (sheetServiceCount.hasOwnProperty(serviceType)) {
          sheetServiceCount[serviceType]++;
        }
        if (row[10] && row[10].toString().toLowerCase().includes('normal')) {
          sheetNormal++;
        } else if (row[10] && row[10].toString().toLowerCase().includes('power')) {
          sheetPower++;
        }
      });
      
      Logger.log('\n' + sheet.getName() + ':');
      Logger.log('  Records: ' + (lastRow - 1));
      Logger.log('  Total: ₹' + sheetTotal.toFixed(2));
      Logger.log('  Volume: ' + sheetVolume.toFixed(2) + 'L');
      Logger.log('  Services - None: ' + sheetServiceCount.None + ' | Air: ' + sheetServiceCount.Air + ' | Oil: ' + sheetServiceCount.Oil + ' | Both: ' + sheetServiceCount.Both);
      Logger.log('  Normal: ' + sheetNormal + ' | Power: ' + sheetPower);
      
      grandTotal += sheetTotal;
      grandVolume += sheetVolume;
      totalServiceCount.None += sheetServiceCount.None;
      totalServiceCount.Air += sheetServiceCount.Air;
      totalServiceCount.Oil += sheetServiceCount.Oil;
      totalServiceCount.Both += sheetServiceCount.Both;
    }
  });
  
  Logger.log('\n=== GRAND TOTAL ===');
  Logger.log('Total spent: ₹' + grandTotal.toFixed(2));
  Logger.log('Total volume: ' + grandVolume.toFixed(2) + 'L');
  Logger.log('Average rate: ₹' + (grandTotal / grandVolume).toFixed(2) + '/L');
  Logger.log('Total service counts:');
  Logger.log('  None: ' + totalServiceCount.None);
  Logger.log('  Air: ' + totalServiceCount.Air);
  Logger.log('  Oil: ' + totalServiceCount.Oil);
  Logger.log('  Both: ' + totalServiceCount.Both);
}