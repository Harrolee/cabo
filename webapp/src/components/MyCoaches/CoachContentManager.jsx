import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../../main';
import { toast } from 'react-hot-toast';

const CoachContentManager = () => {
  const navigate = useNavigate();
  const { coachId } = useParams();
  const [coach, setCoach] = useState(null);
  const [contentFiles, setContentFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleteLoading, setDeleteLoading] = useState({});
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedContentType, setSelectedContentType] = useState('');

  const contentTypes = [
    { id: 'instagram_post', label: 'Instagram Posts', accept: '.txt,.json', description: 'Caption text or exported data' },
    { id: 'video_transcript', label: 'Video Transcripts', accept: '.txt,.srt', description: 'Text transcripts of your videos' },
    { id: 'podcast_transcript', label: 'Podcast Transcripts', accept: '.txt', description: 'Transcripts from podcast episodes' },
    { id: 'written_content', label: 'Written Content', accept: '.txt,.md,.doc,.docx', description: 'Blog posts, articles, newsletters' },
    { id: 'social_media_comment', label: 'Social Media', accept: '.txt,.csv', description: 'Comments, replies, social posts' },
    { id: 'blog_post', label: 'Blog Posts', accept: '.txt,.md,.html', description: 'Published blog content' }
  ];

  useEffect(() => {
    if (coachId) {
      fetchCoachAndContent();
    }
  }, [coachId]);

  const fetchCoachAndContent = async () => {
    try {
      // Get coach details
      const { data: coachData, error: coachError } = await supabase
        .from('coach_profiles')
        .select('*')
        .eq('id', coachId)
        .single();

      if (coachError) throw coachError;
      setCoach(coachData);

      // Get content files
      const { data: contentData, error: contentError } = await supabase
        .from('coach_content_chunks')
        .select('*')
        .eq('coach_id', coachId)
        .order('created_at', { ascending: false });

      if (contentError) throw contentError;
      setContentFiles(contentData || []);
    } catch (error) {
      console.error('Error fetching coach content:', error);
      toast.error('Failed to load coach content');
    } finally {
      setLoading(false);
    }
  };

  const deleteContent = async (contentId, fileName) => {
    if (!window.confirm(`Are you sure you want to delete "${fileName}"? This action cannot be undone.`)) {
      return;
    }

    try {
      setDeleteLoading(prev => ({ ...prev, [contentId]: true }));

      // Delete from database
      const { error } = await supabase
        .from('coach_content_chunks')
        .delete()
        .eq('id', contentId);

      if (error) throw error;

      // Update local state
      setContentFiles(prev => prev.filter(file => file.id !== contentId));
      
      // Update coach's total content pieces count
      const newTotalPieces = contentFiles.length - 1;
      await supabase
        .from('coach_profiles')
        .update({ 
          total_content_pieces: newTotalPieces,
          content_processed: newTotalPieces > 0 // Set to false if no content left
        })
        .eq('id', coachId);

      toast.success(`Deleted "${fileName}" successfully`);
    } catch (error) {
      console.error('Error deleting content:', error);
      toast.error(`Failed to delete "${fileName}"`);
    } finally {
      setDeleteLoading(prev => ({ ...prev, [contentId]: false }));
    }
  };

  const formatFileSize = (sizeInBytes) => {
    if (!sizeInBytes) return 'Unknown size';
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = sizeInBytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    
    return `${size.toFixed(1)} ${units[unitIndex]}`;
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getContentTypeLabel = (contentType) => {
    const typeLabels = {
      'instagram_post': 'Instagram Posts',
      'video_transcript': 'Video Transcripts',
      'podcast_transcript': 'Podcast Transcripts',
      'written_content': 'Written Content',
      'social_media_comment': 'Social Media',
      'blog_post': 'Blog Posts'
    };
    return typeLabels[contentType] || contentType;
  };

  const getFileExtension = (fileName) => {
    if (!fileName) return '';
    return fileName.split('.').pop().toUpperCase();
  };

  const uploadNewContent = async (file, contentType) => {
    if (!file || !contentType) return;

    try {
      setUploading(true);

      // Step 1: Get signed upload URL
      const uploadUrlResponse = await fetch(`${import.meta.env.VITE_API_URL}/coach-file-uploader`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          coachId: coachId,
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type,
          contentType: contentType
        })
      });

      if (!uploadUrlResponse.ok) {
        const error = await uploadUrlResponse.json();
        throw new Error(error.error || 'Failed to get upload URL');
      }

      const { uploadUrl, filePath, fileId, uploadTimestamp } = await uploadUrlResponse.json();

      // Step 2: Upload file directly to GCP Storage
      const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': file.type,
          'x-goog-meta-coach-id': coachId,
          'x-goog-meta-upload-timestamp': uploadTimestamp
        },
        body: file
      });

      if (!uploadResponse.ok) {
        throw new Error('Failed to upload file to storage');
      }

      // Step 3: Process the content
      const processResponse = await fetch(`${import.meta.env.VITE_API_URL}/coach-file-uploader/${fileId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          coachId: coachId,
          filePath: filePath,
          fileName: file.name,
          fileSize: file.size,
          contentType: contentType
        })
      });

      if (!processResponse.ok) {
        console.warn('File uploaded but processing failed');
      }

      // Refresh the content list
      await fetchCoachAndContent();
      
      toast.success(`${file.name} uploaded successfully`);
      setShowUploadModal(false);
      setSelectedContentType('');
    } catch (error) {
      console.error('Error uploading content:', error);
      toast.error(`Failed to upload ${file.name}: ${error.message}`);
    } finally {
      setUploading(false);
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Validate file size (10MB limit)
    if (file.size > 10 * 1024 * 1024) {
      toast.error('File size must be less than 10MB');
      return;
    }

    // Validate file type
    const selectedType = contentTypes.find(type => type.id === selectedContentType);
    if (!selectedType) {
      toast.error('Please select a content type first');
      return;
    }

    const allowedExtensions = selectedType.accept.split(',').map(ext => ext.trim());
    const fileExtension = '.' + file.name.split('.').pop().toLowerCase();
    
    if (!allowedExtensions.includes(fileExtension)) {
      toast.error(`Invalid file type. Allowed types: ${selectedType.accept}`);
      return;
    }

    await uploadNewContent(file, selectedContentType);
  };

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading content...</p>
        </div>
      </div>
    );
  }

  if (!coach) {
    return (
      <div className="p-8 text-center">
        <h1 className="text-2xl font-bold text-gray-900 mb-4">Coach Not Found</h1>
        <button
          onClick={() => navigate('/my-coaches')}
          className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700"
        >
          ← Back to My Coaches
        </button>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="flex items-center gap-4 mb-2">
            <button
              onClick={() => navigate('/my-coaches')}
              className="text-gray-600 hover:text-gray-800 p-2 hover:bg-gray-100 rounded-lg"
              title="Back to My Coaches"
            >
              ←
            </button>
            <h1 className="text-3xl font-bold text-gray-900">Content Manager</h1>
          </div>
          <p className="text-gray-600">
            Manage content files for <span className="font-medium">{coach.name}</span> (@{coach.handle})
          </p>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={() => setShowUploadModal(true)}
            className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 font-medium flex items-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Upload Content
          </button>
          <div className="text-right">
            <div className="text-2xl font-bold text-blue-600">{contentFiles.length}</div>
            <div className="text-sm text-gray-600">Total Files</div>
          </div>
        </div>
      </div>

      {/* Content Status */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Processing Status</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="text-center p-4 bg-blue-50 rounded-lg">
            <div className="text-2xl font-bold text-blue-600">{contentFiles.length}</div>
            <div className="text-sm text-blue-700">Total Files</div>
          </div>
          <div className="text-center p-4 bg-green-50 rounded-lg">
            <div className="text-2xl font-bold text-green-600">
              {contentFiles.filter(f => f.processed).length}
            </div>
            <div className="text-sm text-green-700">Processed</div>
          </div>
          <div className="text-center p-4 bg-purple-50 rounded-lg">
            <div className="text-2xl font-bold text-purple-600">
              {contentFiles.filter(f => f.voice_sample).length}
            </div>
            <div className="text-sm text-purple-700">Voice Samples</div>
          </div>
        </div>
      </div>

      {contentFiles.length === 0 ? (
        /* Empty State */
        <div className="text-center py-16 bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="text-6xl mb-4">📁</div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">No Content Files</h2>
          <p className="text-gray-600 mb-8 max-w-md mx-auto">
            This coach doesn't have any content files yet. Content files help train the AI to respond more like you.
          </p>
          <button
            onClick={() => setShowUploadModal(true)}
            className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 font-medium"
          >
            Add Content Files
          </button>
        </div>
      ) : (
        /* Content Files List */
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Content Files</h2>
            <p className="text-sm text-gray-600 mt-1">
              Manage the content files that train your AI coach's responses
            </p>
          </div>
          
          <div className="divide-y divide-gray-200">
            {contentFiles.map((file) => (
              <div key={file.id} className="p-6 hover:bg-gray-50">
                <div className="flex items-center justify-between">
                  <div className="flex items-start space-x-4 flex-1">
                    {/* File Type Icon */}
                    <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                      <span className="text-blue-600 font-semibold text-sm">
                        {getFileExtension(file.file_name)}
                      </span>
                    </div>
                    
                    {/* File Details */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-lg font-medium text-gray-900 truncate">
                          {file.file_name || 'Unnamed File'}
                        </h3>
                        {file.voice_sample && (
                          <span className="bg-purple-100 text-purple-800 text-xs px-2 py-1 rounded-full">
                            Voice Sample
                          </span>
                        )}
                        <span className={`text-xs px-2 py-1 rounded-full ${
                          file.processed 
                            ? 'bg-green-100 text-green-800' 
                            : 'bg-yellow-100 text-yellow-800'
                        }`}>
                          {file.processed ? 'Processed' : 'Processing'}
                        </span>
                      </div>
                      
                      <div className="space-y-1">
                        <p className="text-sm text-gray-600">
                          <span className="font-medium">Type:</span> {getContentTypeLabel(file.content_type)}
                        </p>
                        <p className="text-sm text-gray-600">
                          <span className="font-medium">Uploaded:</span> {formatDate(file.created_at)}
                        </p>
                        {file.word_count && (
                          <p className="text-sm text-gray-600">
                            <span className="font-medium">Words:</span> {file.word_count.toLocaleString()}
                          </p>
                        )}
                        {file.energy_level && (
                          <p className="text-sm text-gray-600">
                            <span className="font-medium">Energy Level:</span> {file.energy_level}/10
                          </p>
                        )}
                      </div>
                      
                      {/* Tags */}
                      {(file.intent_tags?.length > 0 || file.response_style_tags?.length > 0) && (
                        <div className="flex flex-wrap gap-1 mt-3">
                          {file.intent_tags?.map((tag, index) => (
                            <span
                              key={`intent-${index}`}
                              className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded"
                            >
                              {tag}
                            </span>
                          ))}
                          {file.response_style_tags?.map((tag, index) => (
                            <span
                              key={`style-${index}`}
                              className="bg-indigo-100 text-indigo-800 text-xs px-2 py-1 rounded"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                      
                      {/* Content Preview */}
                      {file.content && (
                        <div className="mt-3 p-3 bg-gray-50 rounded-lg">
                          <p className="text-sm text-gray-700 line-clamp-3">
                            {file.content.substring(0, 200)}
                            {file.content.length > 200 && '...'}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                  
                  {/* Actions */}
                  <div className="flex items-center space-x-2 ml-4">
                    <button
                      onClick={() => deleteContent(file.id, file.file_name)}
                      disabled={deleteLoading[file.id]}
                      className="text-red-600 hover:text-red-800 hover:bg-red-50 p-2 rounded-lg disabled:opacity-50"
                      title="Delete file"
                    >
                      {deleteLoading[file.id] ? (
                        <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-red-600"></div>
                      ) : (
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Help Section */}
      <div className="mt-8 bg-blue-50 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-blue-900 mb-2">💡 Content Management Tips</h3>
        <ul className="text-blue-800 text-sm space-y-1">
          <li>• Remove outdated content that no longer reflects your current voice</li>
          <li>• Keep content that shows strong examples of your coaching style</li>
          <li>• Voice samples are especially valuable for training your AI</li>
          <li>• Processed files are actively used to generate responses</li>
        </ul>
      </div>

      {/* Upload Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">Upload New Content</h3>
                <button
                  onClick={() => {
                    setShowUploadModal(false);
                    setSelectedContentType('');
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Content Type Selection */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Content Type
                </label>
                <select
                  value={selectedContentType}
                  onChange={(e) => setSelectedContentType(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  disabled={uploading}
                >
                  <option value="">Select content type...</option>
                  {contentTypes.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.label}
                    </option>
                  ))}
                </select>
                {selectedContentType && (
                  <p className="text-xs text-gray-500 mt-1">
                    Accepts: {contentTypes.find(t => t.id === selectedContentType)?.accept}
                  </p>
                )}
              </div>

              {/* File Upload */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Select File
                </label>
                <input
                  type="file"
                  onChange={handleFileUpload}
                  accept={selectedContentType ? contentTypes.find(t => t.id === selectedContentType)?.accept : ''}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  disabled={uploading || !selectedContentType}
                />
                <p className="text-xs text-gray-500 mt-1">
                  Maximum file size: 10MB
                </p>
              </div>

              {/* Upload Status */}
              {uploading && (
                <div className="mb-4 p-3 bg-blue-50 rounded-lg">
                  <div className="flex items-center">
                    <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-blue-600 mr-3"></div>
                    <span className="text-blue-900 text-sm">Uploading and processing...</span>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => {
                    setShowUploadModal(false);
                    setSelectedContentType('');
                  }}
                  disabled={uploading}
                  className="px-4 py-2 text-gray-600 hover:text-gray-800 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CoachContentManager; 