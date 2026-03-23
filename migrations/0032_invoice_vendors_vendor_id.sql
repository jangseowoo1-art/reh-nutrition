-- hospital_invoice_vendors 테이블에 vendor_id 컬럼 추가
-- 발주 업체(vendors)와 연결하기 위한 외래키

ALTER TABLE hospital_invoice_vendors ADD COLUMN vendor_id INTEGER REFERENCES vendors(id);

-- 기존 데이터: vendor_name_norm으로 vendors 테이블과 매칭 시도
UPDATE hospital_invoice_vendors
SET vendor_id = (
  SELECT v.id FROM vendors v
  WHERE v.hospital_id = hospital_invoice_vendors.hospital_id
    AND LOWER(REPLACE(REPLACE(v.name, ' ', ''), '(주)', '')) = LOWER(REPLACE(REPLACE(hospital_invoice_vendors.vendor_name_norm, ' ', ''), '(주)', ''))
  LIMIT 1
)
WHERE vendor_id IS NULL;

-- 인덱스 추가
CREATE INDEX IF NOT EXISTS idx_hiv_vendor_id ON hospital_invoice_vendors(vendor_id);
CREATE INDEX IF NOT EXISTS idx_hiv_hospital_vendor ON hospital_invoice_vendors(hospital_id, vendor_id);
