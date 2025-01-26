import React from 'react';
import { Modal } from './Modal';
import { MessageFlowInfo } from './MessageFlowInfo';
import { TermsOfService } from './TermsOfService';
import { DataPolicy } from './DataPolicy';

export function PolicyModals({ showInfo, showTerms, showPrivacy, handleModalClose }) {
  return (
    <>
      <Modal
        isOpen={showInfo}
        onClose={handleModalClose}
        title="Message Flow Information"
      >
        <MessageFlowInfo />
      </Modal>

      <Modal
        isOpen={showTerms}
        onClose={handleModalClose}
        title="Terms of Service"
      >
        <TermsOfService />
      </Modal>

      <Modal
        isOpen={showPrivacy}
        onClose={handleModalClose}
        title="Privacy Policy"
      >
        <DataPolicy />
      </Modal>
    </>
  );
} 